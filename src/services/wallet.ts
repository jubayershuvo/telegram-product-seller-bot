import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import { User } from '../models/User';
import { Transaction, TxType } from '../models/Transaction';
import { AppError, isDuplicateKeyError } from '../utils/errors';
import { logger } from '../utils/logger';
import { round2 } from '../utils/money';

export interface WalletOp {
  userId: Types.ObjectId;
  /** positive amount, max 2 decimals */
  amount: number;
  /** idempotency key: the same key can only ever be applied once per user */
  opKey: string;
  type: TxType;
  refType?: 'order' | 'deposit';
  refId?: Types.ObjectId;
  note?: string;
}

export interface WalletResult {
  ok: boolean;
  reason?: 'insufficient' | 'duplicate' | 'no_user';
  balanceAfter?: number;
}

/**
 * Atomic, idempotent balance change using a single findOneAndUpdate:
 *  - debit only succeeds if balance >= amount (no negative balances, no double spend)
 *  - the opKey is stored on the user document in the same atomic update,
 *    so replaying the same operation (retry/recovery) can never apply it twice.
 */
async function apply(op: WalletOp, sign: 1 | -1): Promise<WalletResult> {
  if (!Number.isFinite(op.amount) || op.amount <= 0 || round2(op.amount) !== op.amount) throw new AppError('Invalid amount');
  const delta = sign * op.amount;
  const filter: Record<string, unknown> = { _id: op.userId, ops: { $ne: op.opKey } };
  // amounts have 2 decimals, so a real shortfall is always >= 0.01; the 0.001 slack only absorbs float noise
  if (sign === -1) filter.balance = { $gte: op.amount - 0.001 };

  const updated = await User.findOneAndUpdate(
    filter,
    { $inc: { balance: delta }, $push: { ops: { $each: [op.opKey], $slice: -200 } } } as any,
    { new: true },
  );

  if (!updated) {
    const u = await User.findById(op.userId).select('ops balance');
    if (!u) return { ok: false, reason: 'no_user' };
    if (u.ops.includes(op.opKey)) return { ok: false, reason: 'duplicate', balanceAfter: round2(u.balance) };
    return { ok: false, reason: 'insufficient', balanceAfter: round2(u.balance) };
  }

  try {
    await Transaction.create({
      userId: updated._id,
      telegramId: updated.telegramId,
      type: op.type,
      amount: delta,
      balanceAfter: round2(updated.balance),
      refType: op.refType,
      refId: op.refId,
      note: op.note,
      opKey: op.opKey,
    });
  } catch (e) {
    if (!isDuplicateKeyError(e)) logger.error({ opKey: op.opKey }, 'Failed to write ledger entry (balance already updated)');
  }
  return { ok: true, balanceAfter: round2(updated.balance) };
}

export const creditWallet = (op: WalletOp) => apply(op, 1);
export const debitWallet = (op: WalletOp) => apply(op, -1);
export const newOpKey = (prefix: string) => `${prefix}:${randomUUID()}`;
