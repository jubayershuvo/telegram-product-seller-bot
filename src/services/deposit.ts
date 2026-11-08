import { Types } from 'mongoose';
import { Deposit } from '../models/Deposit';
import { User } from '../models/User';
import { Transaction } from '../models/Transaction';
import { creditWallet } from './wallet';
import { verifyPayment, PaymentProvider, PaymentVerifyResult } from '../lib/payment-verifier';
import { getSettings } from './settings';
import { evaluate } from './rechargeGate';
import { SETTING_DEFAULTS } from '../models/Setting';
import { AppError, isDuplicateKeyError, safeError } from '../utils/errors';
import { fmt, round2 } from '../utils/money';
import { logger } from '../utils/logger';

const PROVIDER: Record<'bkash' | 'nagad', PaymentProvider> = { bkash: 'bKash', nagad: 'NAGAD' };

export const normalizeTrxId = (s: string) => s.replace(/\s+/g, '').toUpperCase();

export function isValidTrxIdFormat(trx: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, 'i').test(trx);
  } catch {
    return new RegExp(SETTING_DEFAULTS.trxIdRegex, 'i').test(trx);
  }
}

export interface DepositOutcome {
  credited: number;
  balance: number;
  depositId: Types.ObjectId;
}

export async function submitDeposit(args: {
  userId: Types.ObjectId;
  telegramId: number;
  method: 'bkash' | 'nagad';
  rawTrxId: string;
}): Promise<DepositOutcome> {
  const s = await getSettings();

  // Server-side gate: admin switch + daily schedule are enforced here too, not just in the UI.
  const gate = evaluate(s);
  if (!gate.open) throw new AppError(gate.message ?? 'Recharge is closed.', 'RECHARGE_CLOSED');

  const trxId = normalizeTrxId(args.rawTrxId);
  if (!isValidTrxIdFormat(trxId, s.trxIdRegex)) throw new AppError('❌ Invalid TrxID format. Please copy it exactly from your payment SMS/app.');

  const since = new Date(Date.now() - 3600_000);
  const recentFails = await Deposit.countDocuments({ userId: args.userId, status: 'failed', createdAt: { $gte: since } });
  if (recentFails >= s.maxFailedTrxPerHour) {
    throw new AppError('⛔ Too many failed attempts. Please try again in an hour or contact support.', 'TOO_MANY');
  }

  // Claim the TrxID. The unique partial index guarantees only ONE deposit can own a given TrxID.
  let deposit;
  try {
    deposit = await Deposit.create({
      userId: args.userId,
      telegramId: args.telegramId,
      method: args.method,
      trxId,
      status: 'processing',
      locked: true,
    });
  } catch (e) {
    if (isDuplicateKeyError(e)) throw new AppError('❌ This TrxID has already been used.', 'TRX_DUPLICATE');
    throw e;
  }

  const fail = async (reason: string) => {
    await Deposit.updateOne({ _id: deposit._id }, { status: 'failed', locked: false, failReason: reason.slice(0, 300) });
  };

  // Verify against the synced SMS inbox (src/lib/payment-verifier.ts)
  let result;
  try {
    result = await verifyPayment({ trxId, provider: PROVIDER[args.method] });
  } catch (e) {
    result = { success: false, verified: false, trxId, error: 'verifier crashed' } as PaymentVerifyResult;
    logger.error({ err: safeError(e) }, 'Verifier crashed');
  }

  // The SMS service itself failed (bad key, network, 5xx): not the user's fault. Release the TrxID and
  // don't count it as a failed attempt.
  if (!result.success) {
    logger.error({ reason: result.error }, 'SMS verification service error');
    await Deposit.deleteOne({ _id: deposit._id });
    throw new AppError('⚠️ Payment verification is temporarily unavailable. Your TrxID was not used, please try again shortly.', 'VERIFIER_DOWN');
  }

  if (!result.verified) {
    await fail(result.error ?? 'not verified');
    const notFound = result.error === 'Transaction ID not found.';
    throw new AppError(
      notFound
        ? '❌ Transaction not found. Check the TrxID and the provider you selected. If you just paid, wait a minute and try again.'
        : '❌ This transaction could not be verified.',
      'NOT_VERIFIED',
    );
  }

  await Deposit.updateOne({ _id: deposit._id }, { rawResponse: JSON.stringify({ provider: result.provider, amount: result.amount, sender: result.sender, receivedAt: result.receivedAt }) });

  // The amount always comes from the SMS, kept to 2 decimals.
  const credit = typeof result.amount === 'number' && Number.isFinite(result.amount) ? round2(result.amount) : 0;
  if (credit <= 0) {
    await fail('amount not found in SMS');
    throw new AppError('❌ Could not read the paid amount from this transaction. Please contact support with your TrxID.', 'NOT_VERIFIED');
  }
  if (credit < s.minRecharge || credit > s.maxRecharge) {
    await fail(`amount ${credit} outside limits ${s.minRecharge}-${s.maxRecharge}`);
    throw new AppError(`❌ Recharge amount must be between ${fmt(s.minRecharge)} and ${fmt(s.maxRecharge)}. This payment was ${fmt(credit)} — contact support with your TrxID.`, 'AMOUNT_LIMIT');
  }

  // From here on the TrxID stays locked no matter what: if anything below fails, recovery.ts repairs it.
  const wallet = await creditWallet({
    userId: args.userId,
    amount: credit,
    opKey: `dep:${deposit.id}`,
    type: 'deposit',
    refType: 'deposit',
    refId: deposit._id,
    note: `${args.method} ${trxId}`,
  });
  await Deposit.updateOne({ _id: deposit._id }, { status: 'verified', verifiedAmount: credit });
  await User.updateOne({ _id: args.userId }, { $inc: { totalDeposited: credit } });

  const balance = wallet.balanceAfter ?? (await User.findById(args.userId).select('balance'))?.balance ?? 0;
  return { credited: credit, balance, depositId: deposit._id };
}

/** Repair deposits left in "processing" by a crash. */
export async function recoverStaleDeposits(): Promise<void> {
  const stale = await Deposit.find({ status: 'processing', createdAt: { $lt: new Date(Date.now() - 2 * 60_000) } });
  for (const d of stale) {
    const user = await User.findById(d.userId).select('ops');
    const opKey = `dep:${d.id}`;
    if (user?.ops.includes(opKey)) {
      const tx = await Transaction.findOne({ opKey }).lean();
      await Deposit.updateOne({ _id: d._id }, { status: 'verified', verifiedAmount: tx?.amount });
      if (tx) await User.updateOne({ _id: d.userId }, { $inc: { totalDeposited: tx.amount } });
      logger.warn({ deposit: d.id }, 'Recovered credited deposit');
    } else {
      await Deposit.updateOne({ _id: d._id }, { status: 'failed', locked: false, failReason: 'stale (interrupted)' });
      logger.warn({ deposit: d.id }, 'Released stale deposit');
    }
  }
}
