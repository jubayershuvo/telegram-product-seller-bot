import { Types } from 'mongoose';
import { Order, OrderDoc } from '../models/Order';
import { User } from '../models/User';
import { Email } from '../models/Email';
import { creditWallet, debitWallet } from './wallet';
import { releaseEmails, reserveEmails, getOrderEmails, maxBuyable } from './inventory';
import { getSettings } from './settings';
import { AppError } from '../utils/errors';
import { fmt, lineTotal, round2 } from '../utils/money';
import { logger } from '../utils/logger';

/**
 * Purchase flow (no replica set / multi-document transactions required):
 *  1. create Order(processing)
 *  2. atomic idempotent wallet debit  (opKey buy:<orderId>)
 *  3. atomic per-document reservation of emails (status available -> sold)
 *  4. mark order completed
 * Any failure rolls back idempotently (release emails + refund with opKey refund:<orderId>).
 * A crash in the middle is repaired by services/recovery.ts.
 */
export async function purchaseEmails(
  userId: Types.ObjectId,
  telegramId: number,
  quantity: number,
  expectedUnitPrice: number,
): Promise<{ order: OrderDoc; addresses: string[] }> {
  const { price: unitPrice, maxQty } = await getSettings();
  if (!Number.isInteger(quantity) || quantity < 1) throw new AppError('Invalid quantity.');
  if (maxQty > 0 && quantity > maxQty) throw new AppError(`Maximum ${maxQty} emails per purchase.`);
  if (round2(unitPrice) !== round2(expectedUnitPrice)) {
    throw new AppError(`The price has changed to ${fmt(unitPrice)} per email. Please start the purchase again.`, 'PRICE_CHANGED');
  }
  const available = await Email.countDocuments({ status: 'available' });
  if (quantity > maxBuyable(available, maxQty)) throw new AppError(`Only ${available} emails are available right now.`, 'NO_STOCK');

  const total = lineTotal(unitPrice, quantity);
  const order = await Order.create({ userId, telegramId, quantity, unitPrice, total, status: 'processing' });

  try {
    const debit = await debitWallet({
      userId,
      amount: total,
      opKey: `buy:${order.id}`,
      type: 'purchase',
      refType: 'order',
      refId: order._id,
      note: `${quantity} emails @ ${fmt(unitPrice)}`,
    });
    if (!debit.ok) {
      await Order.updateOne({ _id: order._id }, { status: 'failed', failReason: debit.reason });
      throw new AppError(
        debit.reason === 'insufficient' ? '❌ Insufficient balance. Please recharge your wallet.' : 'Payment could not be processed.',
        'INSUFFICIENT',
      );
    }

    const reserved = await reserveEmails(order._id, userId, quantity);
    if (reserved < quantity) {
      await rollbackOrder(order._id, 'stock changed during purchase');
      throw new AppError('Stock changed while processing. You have not been charged, please try again.', 'NO_STOCK');
    }

    const addresses = await getOrderEmails(order._id, userId);
    const done = await Order.updateOne({ _id: order._id, status: 'processing' }, { status: 'completed', completedAt: new Date() });
    if (done.modifiedCount !== 1) throw new Error('Order state changed unexpectedly');
    await User.updateOne({ _id: userId }, { $inc: { totalSpent: total } });

    order.status = 'completed';
    return { order, addresses };
  } catch (err) {
    if (!(err instanceof AppError)) {
      logger.error({ orderId: order.id }, 'Unexpected purchase error, rolling back');
      await rollbackOrder(order._id, 'unexpected error').catch(() => undefined);
    }
    throw err;
  }
}

/** Idempotent: safe to call repeatedly (by the flow itself or by the recovery job). */
export async function rollbackOrder(orderId: Types.ObjectId, reason: string): Promise<void> {
  const order = await Order.findById(orderId);
  if (!order || order.status !== 'processing') return;

  await releaseEmails(order._id);
  const user = await User.findById(order.userId).select('ops');
  if (user && user.ops.includes(`buy:${order.id}`)) {
    await creditWallet({
      userId: order.userId,
      amount: order.total,
      opKey: `refund:${order.id}`,
      type: 'refund',
      refType: 'order',
      refId: order._id,
      note: `Refund (${reason})`,
    });
  }
  await Order.updateOne({ _id: order._id, status: 'processing' }, { status: 'failed', failReason: reason });
}
