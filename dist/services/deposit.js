"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeTrxId = void 0;
exports.isValidTrxIdFormat = isValidTrxIdFormat;
exports.submitDeposit = submitDeposit;
exports.recoverStaleDeposits = recoverStaleDeposits;
const Deposit_1 = require("../models/Deposit");
const User_1 = require("../models/User");
const Transaction_1 = require("../models/Transaction");
const wallet_1 = require("./wallet");
const payment_verifier_1 = require("../lib/payment-verifier");
const settings_1 = require("./settings");
const rechargeGate_1 = require("./rechargeGate");
const Setting_1 = require("../models/Setting");
const errors_1 = require("../utils/errors");
const money_1 = require("../utils/money");
const logger_1 = require("../utils/logger");
const PROVIDER = { bkash: 'bKash', nagad: 'NAGAD' };
const normalizeTrxId = (s) => s.replace(/\s+/g, '').toUpperCase();
exports.normalizeTrxId = normalizeTrxId;
function isValidTrxIdFormat(trx, pattern) {
    try {
        return new RegExp(pattern, 'i').test(trx);
    }
    catch {
        return new RegExp(Setting_1.SETTING_DEFAULTS.trxIdRegex, 'i').test(trx);
    }
}
async function submitDeposit(args) {
    const s = await (0, settings_1.getSettings)();
    // Server-side gate: admin switch + daily schedule are enforced here too, not just in the UI.
    const gate = (0, rechargeGate_1.evaluate)(s);
    if (!gate.open)
        throw new errors_1.AppError(gate.message ?? 'Recharge is closed.', 'RECHARGE_CLOSED');
    const trxId = (0, exports.normalizeTrxId)(args.rawTrxId);
    if (!isValidTrxIdFormat(trxId, s.trxIdRegex))
        throw new errors_1.AppError('❌ Invalid TrxID format. Please copy it exactly from your payment SMS/app.');
    const since = new Date(Date.now() - 3600_000);
    const recentFails = await Deposit_1.Deposit.countDocuments({ userId: args.userId, status: 'failed', createdAt: { $gte: since } });
    if (recentFails >= s.maxFailedTrxPerHour) {
        throw new errors_1.AppError('⛔ Too many failed attempts. Please try again in an hour or contact support.', 'TOO_MANY');
    }
    // Claim the TrxID. The unique partial index guarantees only ONE deposit can own a given TrxID.
    let deposit;
    try {
        deposit = await Deposit_1.Deposit.create({
            userId: args.userId,
            telegramId: args.telegramId,
            method: args.method,
            trxId,
            status: 'processing',
            locked: true,
        });
    }
    catch (e) {
        if ((0, errors_1.isDuplicateKeyError)(e))
            throw new errors_1.AppError('❌ This TrxID has already been used.', 'TRX_DUPLICATE');
        throw e;
    }
    const fail = async (reason) => {
        await Deposit_1.Deposit.updateOne({ _id: deposit._id }, { status: 'failed', locked: false, failReason: reason.slice(0, 300) });
    };
    // Verify against the synced SMS inbox (src/lib/payment-verifier.ts)
    let result;
    try {
        result = await (0, payment_verifier_1.verifyPayment)({ trxId, provider: PROVIDER[args.method] });
    }
    catch (e) {
        result = { success: false, verified: false, trxId, error: 'verifier crashed' };
        logger_1.logger.error({ err: (0, errors_1.safeError)(e) }, 'Verifier crashed');
    }
    // The SMS service itself failed (bad key, network, 5xx): not the user's fault. Release the TrxID and
    // don't count it as a failed attempt.
    if (!result.success) {
        logger_1.logger.error({ reason: result.error }, 'SMS verification service error');
        await Deposit_1.Deposit.deleteOne({ _id: deposit._id });
        throw new errors_1.AppError('⚠️ Payment verification is temporarily unavailable. Your TrxID was not used, please try again shortly.', 'VERIFIER_DOWN');
    }
    if (!result.verified) {
        await fail(result.error ?? 'not verified');
        const notFound = result.error === 'Transaction ID not found.';
        throw new errors_1.AppError(notFound
            ? '❌ Transaction not found. Check the TrxID and the provider you selected. If you just paid, wait a minute and try again.'
            : '❌ This transaction could not be verified.', 'NOT_VERIFIED');
    }
    await Deposit_1.Deposit.updateOne({ _id: deposit._id }, { rawResponse: JSON.stringify({ provider: result.provider, amount: result.amount, sender: result.sender, receivedAt: result.receivedAt }) });
    // The amount always comes from the SMS, kept to 2 decimals.
    const credit = typeof result.amount === 'number' && Number.isFinite(result.amount) ? (0, money_1.round2)(result.amount) : 0;
    if (credit <= 0) {
        await fail('amount not found in SMS');
        throw new errors_1.AppError('❌ Could not read the paid amount from this transaction. Please contact support with your TrxID.', 'NOT_VERIFIED');
    }
    if (credit < s.minRecharge || credit > s.maxRecharge) {
        await fail(`amount ${credit} outside limits ${s.minRecharge}-${s.maxRecharge}`);
        throw new errors_1.AppError(`❌ Recharge amount must be between ${(0, money_1.fmt)(s.minRecharge)} and ${(0, money_1.fmt)(s.maxRecharge)}. This payment was ${(0, money_1.fmt)(credit)} — contact support with your TrxID.`, 'AMOUNT_LIMIT');
    }
    // From here on the TrxID stays locked no matter what: if anything below fails, recovery.ts repairs it.
    const wallet = await (0, wallet_1.creditWallet)({
        userId: args.userId,
        amount: credit,
        opKey: `dep:${deposit.id}`,
        type: 'deposit',
        refType: 'deposit',
        refId: deposit._id,
        note: `${args.method} ${trxId}`,
    });
    await Deposit_1.Deposit.updateOne({ _id: deposit._id }, { status: 'verified', verifiedAmount: credit });
    await User_1.User.updateOne({ _id: args.userId }, { $inc: { totalDeposited: credit } });
    const balance = wallet.balanceAfter ?? (await User_1.User.findById(args.userId).select('balance'))?.balance ?? 0;
    return { credited: credit, balance, depositId: deposit._id };
}
/** Repair deposits left in "processing" by a crash. */
async function recoverStaleDeposits() {
    const stale = await Deposit_1.Deposit.find({ status: 'processing', createdAt: { $lt: new Date(Date.now() - 2 * 60_000) } });
    for (const d of stale) {
        const user = await User_1.User.findById(d.userId).select('ops');
        const opKey = `dep:${d.id}`;
        if (user?.ops.includes(opKey)) {
            const tx = await Transaction_1.Transaction.findOne({ opKey }).lean();
            await Deposit_1.Deposit.updateOne({ _id: d._id }, { status: 'verified', verifiedAmount: tx?.amount });
            if (tx)
                await User_1.User.updateOne({ _id: d.userId }, { $inc: { totalDeposited: tx.amount } });
            logger_1.logger.warn({ deposit: d.id }, 'Recovered credited deposit');
        }
        else {
            await Deposit_1.Deposit.updateOne({ _id: d._id }, { status: 'failed', locked: false, failReason: 'stale (interrupted)' });
            logger_1.logger.warn({ deposit: d.id }, 'Released stale deposit');
        }
    }
}
//# sourceMappingURL=deposit.js.map