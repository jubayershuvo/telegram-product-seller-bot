"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.purchaseEmails = purchaseEmails;
exports.rollbackOrder = rollbackOrder;
const Order_1 = require("../models/Order");
const User_1 = require("../models/User");
const Email_1 = require("../models/Email");
const wallet_1 = require("./wallet");
const inventory_1 = require("./inventory");
const settings_1 = require("./settings");
const errors_1 = require("../utils/errors");
const money_1 = require("../utils/money");
const logger_1 = require("../utils/logger");
/**
 * Purchase flow (no replica set / multi-document transactions required):
 *  1. create Order(processing)
 *  2. atomic idempotent wallet debit  (opKey buy:<orderId>)
 *  3. atomic per-document reservation of emails (status available -> sold)
 *  4. mark order completed
 * Any failure rolls back idempotently (release emails + refund with opKey refund:<orderId>).
 * A crash in the middle is repaired by services/recovery.ts.
 */
async function purchaseEmails(userId, telegramId, quantity, expectedUnitPrice) {
    const { price: unitPrice, maxQty } = await (0, settings_1.getSettings)();
    if (!Number.isInteger(quantity) || quantity < 1)
        throw new errors_1.AppError('Invalid quantity.');
    if (maxQty > 0 && quantity > maxQty)
        throw new errors_1.AppError(`Maximum ${maxQty} emails per purchase.`);
    if ((0, money_1.round2)(unitPrice) !== (0, money_1.round2)(expectedUnitPrice)) {
        throw new errors_1.AppError(`The price has changed to ${(0, money_1.fmt)(unitPrice)} per email. Please start the purchase again.`, 'PRICE_CHANGED');
    }
    const available = await Email_1.Email.countDocuments({ status: 'available' });
    if (quantity > (0, inventory_1.maxBuyable)(available, maxQty))
        throw new errors_1.AppError(`Only ${available} emails are available right now.`, 'NO_STOCK');
    const total = (0, money_1.lineTotal)(unitPrice, quantity);
    const order = await Order_1.Order.create({ userId, telegramId, quantity, unitPrice, total, status: 'processing' });
    try {
        const debit = await (0, wallet_1.debitWallet)({
            userId,
            amount: total,
            opKey: `buy:${order.id}`,
            type: 'purchase',
            refType: 'order',
            refId: order._id,
            note: `${quantity} emails @ ${(0, money_1.fmt)(unitPrice)}`,
        });
        if (!debit.ok) {
            await Order_1.Order.updateOne({ _id: order._id }, { status: 'failed', failReason: debit.reason });
            throw new errors_1.AppError(debit.reason === 'insufficient' ? '❌ Insufficient balance. Please recharge your wallet.' : 'Payment could not be processed.', 'INSUFFICIENT');
        }
        const reserved = await (0, inventory_1.reserveEmails)(order._id, userId, quantity);
        if (reserved < quantity) {
            await rollbackOrder(order._id, 'stock changed during purchase');
            throw new errors_1.AppError('Stock changed while processing. You have not been charged, please try again.', 'NO_STOCK');
        }
        const addresses = await (0, inventory_1.getOrderEmails)(order._id, userId);
        const done = await Order_1.Order.updateOne({ _id: order._id, status: 'processing' }, { status: 'completed', completedAt: new Date() });
        if (done.modifiedCount !== 1)
            throw new Error('Order state changed unexpectedly');
        await User_1.User.updateOne({ _id: userId }, { $inc: { totalSpent: total } });
        order.status = 'completed';
        return { order, addresses };
    }
    catch (err) {
        if (!(err instanceof errors_1.AppError)) {
            logger_1.logger.error({ orderId: order.id }, 'Unexpected purchase error, rolling back');
            await rollbackOrder(order._id, 'unexpected error').catch(() => undefined);
        }
        throw err;
    }
}
/** Idempotent: safe to call repeatedly (by the flow itself or by the recovery job). */
async function rollbackOrder(orderId, reason) {
    const order = await Order_1.Order.findById(orderId);
    if (!order || order.status !== 'processing')
        return;
    await (0, inventory_1.releaseEmails)(order._id);
    const user = await User_1.User.findById(order.userId).select('ops');
    if (user && user.ops.includes(`buy:${order.id}`)) {
        await (0, wallet_1.creditWallet)({
            userId: order.userId,
            amount: order.total,
            opKey: `refund:${order.id}`,
            type: 'refund',
            refType: 'order',
            refId: order._id,
            note: `Refund (${reason})`,
        });
    }
    await Order_1.Order.updateOne({ _id: order._id, status: 'processing' }, { status: 'failed', failReason: reason });
}
//# sourceMappingURL=purchase.js.map