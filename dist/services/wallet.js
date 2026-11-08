"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.newOpKey = exports.debitWallet = exports.creditWallet = void 0;
const crypto_1 = require("crypto");
const User_1 = require("../models/User");
const Transaction_1 = require("../models/Transaction");
const errors_1 = require("../utils/errors");
const logger_1 = require("../utils/logger");
const money_1 = require("../utils/money");
/**
 * Atomic, idempotent balance change using a single findOneAndUpdate:
 *  - debit only succeeds if balance >= amount (no negative balances, no double spend)
 *  - the opKey is stored on the user document in the same atomic update,
 *    so replaying the same operation (retry/recovery) can never apply it twice.
 */
async function apply(op, sign) {
    if (!Number.isFinite(op.amount) || op.amount <= 0 || (0, money_1.round2)(op.amount) !== op.amount)
        throw new errors_1.AppError('Invalid amount');
    const delta = sign * op.amount;
    const filter = { _id: op.userId, ops: { $ne: op.opKey } };
    // amounts have 2 decimals, so a real shortfall is always >= 0.01; the 0.001 slack only absorbs float noise
    if (sign === -1)
        filter.balance = { $gte: op.amount - 0.001 };
    const updated = await User_1.User.findOneAndUpdate(filter, { $inc: { balance: delta }, $push: { ops: { $each: [op.opKey], $slice: -200 } } }, { new: true });
    if (!updated) {
        const u = await User_1.User.findById(op.userId).select('ops balance');
        if (!u)
            return { ok: false, reason: 'no_user' };
        if (u.ops.includes(op.opKey))
            return { ok: false, reason: 'duplicate', balanceAfter: (0, money_1.round2)(u.balance) };
        return { ok: false, reason: 'insufficient', balanceAfter: (0, money_1.round2)(u.balance) };
    }
    try {
        await Transaction_1.Transaction.create({
            userId: updated._id,
            telegramId: updated.telegramId,
            type: op.type,
            amount: delta,
            balanceAfter: (0, money_1.round2)(updated.balance),
            refType: op.refType,
            refId: op.refId,
            note: op.note,
            opKey: op.opKey,
        });
    }
    catch (e) {
        if (!(0, errors_1.isDuplicateKeyError)(e))
            logger_1.logger.error({ opKey: op.opKey }, 'Failed to write ledger entry (balance already updated)');
    }
    return { ok: true, balanceAfter: (0, money_1.round2)(updated.balance) };
}
const creditWallet = (op) => apply(op, 1);
exports.creditWallet = creditWallet;
const debitWallet = (op) => apply(op, -1);
exports.debitWallet = debitWallet;
const newOpKey = (prefix) => `${prefix}:${(0, crypto_1.randomUUID)()}`;
exports.newOpKey = newOpKey;
//# sourceMappingURL=wallet.js.map