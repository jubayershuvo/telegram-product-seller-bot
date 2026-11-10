import { Types } from 'mongoose';
import { Order, OrderDoc } from '../models/Order';
import { User } from '../models/User';
import { Product } from '../models/Product';
import { Item } from '../models/Item';
import { creditWallet, debitWallet } from './wallet';
import { releaseItems, reserveItems, getOrderRows } from './inventory';
import { limitsOf } from './catalog';
import { AppError } from '../utils/errors';
import { fmt, lineTotal, round2 } from '../utils/money';
import { logger } from '../utils/logger';

/**
 * Purchase flow for ONE product per order (no replica set / multi-document transactions required):
 *  1. create Order(processing) with a snapshot of the product's name, price and file structure
 *  2. atomic idempotent wallet debit  (opKey buy:<orderId>)
 *  3. atomic per-document reservation of that product's items (status available -> sold)
 *  4. mark order completed
 * Any failure rolls back idempotently (release items + refund with opKey refund:<orderId>).
 * A crash in the middle is repaired by services/recovery.ts.
 */
export async function purchaseProduct(
  userId: Types.ObjectId,
  telegramId: number,
  productId: Types.ObjectId,
  quantity: number,
  expectedUnitPrice: number,
): Promise<{ order: OrderDoc; rows: string[][] }> {
  if (!Number.isInteger(quantity) || quantity < 1) throw new AppError('Invalid quantity.');

  const product = await Product.findById(productId);
  if (!product || !product.active) throw new AppError('This product is no longer available.', 'NO_PRODUCT');
  if (product.columnCount < 1) throw new AppError('This product is not ready yet.', 'NO_PRODUCT');
  const unitPrice = product.price;
  if (round2(unitPrice) !== round2(expectedUnitPrice)) {
    throw new AppError(`The price has changed to ${fmt(unitPrice)} each. Please start the purchase again.`, 'PRICE_CHANGED');
  }
  // order limits belong to the product (min / max per order)
  const { min, cap } = limitsOf(product);
  if (quantity < min) throw new AppError(`The minimum order for ${product.name} is ${min}.`, 'MIN_QTY');
  if (cap > 0 && quantity > cap) throw new AppError(`The maximum order for ${product.name} is ${cap}.`, 'MAX_QTY');
  const available = await Item.countDocuments({ productId, status: 'available' });
  if (quantity > available) throw new AppError(`Only ${available} available right now.`, 'NO_STOCK');

  const total = lineTotal(unitPrice, quantity);
  const order = await Order.create({
    userId,
    telegramId,
    productId,
    productName: product.name,
    columns: product.columns,
    hasHeader: product.hasHeader,
    format: product.format,
    quantity,
    unitPrice,
    total,
    status: 'processing',
  });

  try {
    const debit = await debitWallet({
      userId,
      amount: total,
      opKey: `buy:${order.id}`,
      type: 'purchase',
      refType: 'order',
      refId: order._id,
      note: `${quantity} × ${product.name} @ ${fmt(unitPrice)}`,
    });
    if (!debit.ok) {
      await Order.updateOne({ _id: order._id }, { status: 'failed', failReason: debit.reason });
      throw new AppError(
        debit.reason === 'insufficient' ? '❌ Insufficient balance. Please recharge your wallet.' : 'Payment could not be processed.',
        'INSUFFICIENT',
      );
    }

    const reserved = await reserveItems(order._id, userId, productId, quantity);
    if (reserved < quantity) {
      await rollbackOrder(order._id, 'stock changed during purchase');
      throw new AppError('Stock changed while processing. You have not been charged, please try again.', 'NO_STOCK');
    }

    const rows = await getOrderRows(order._id, userId);
    const done = await Order.updateOne({ _id: order._id, status: 'processing' }, { status: 'completed', completedAt: new Date() });
    if (done.modifiedCount !== 1) throw new Error('Order state changed unexpectedly');
    await User.updateOne({ _id: userId }, { $inc: { totalSpent: total } });

    order.status = 'completed';
    return { order, rows };
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

  await releaseItems(order._id);
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
