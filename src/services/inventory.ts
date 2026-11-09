import { Types } from 'mongoose';
import { Item } from '../models/Item';
import { getStockMap, Stock } from './catalog';

/** totals over ALL products */
export async function getStock(): Promise<Stock> {
  const total: Stock = { total: 0, available: 0, sold: 0 };
  for (const s of (await getStockMap()).values()) {
    total.total += s.total;
    total.available += s.available;
    total.sold += s.sold;
  }
  return total;
}

/** Highest quantity a user may order: what is in stock, optionally capped by the admin `maxQty` setting (0 = no cap). */
export const maxBuyable = (available: number, maxQty: number): number => (maxQty > 0 ? Math.min(available, maxQty) : available);

/**
 * Reserve (= mark as sold) `qty` items of ONE product for an order.
 * Every document is flipped with a filter on status:'available', which MongoDB applies atomically per document,
 * so two concurrent buyers can never receive the same row. Returns how many were actually reserved.
 */
export async function reserveItems(orderId: Types.ObjectId, userId: Types.ObjectId, productId: Types.ObjectId, qty: number): Promise<number> {
  let reserved = 0;
  for (let attempt = 0; attempt < 25 && reserved < qty; attempt++) {
    const candidates = await Item.find({ productId, status: 'available' })
      .sort({ _id: 1 })
      .limit(qty - reserved)
      .select('_id')
      .lean();
    if (candidates.length === 0) break;
    const res = await Item.updateMany(
      { _id: { $in: candidates.map((c) => c._id) }, status: 'available' },
      { $set: { status: 'sold', soldTo: userId, orderId, soldAt: new Date() } },
    );
    reserved += res.modifiedCount;
  }
  return reserved;
}

export async function releaseItems(orderId: Types.ObjectId): Promise<void> {
  await Item.updateMany({ orderId, status: 'sold' }, { $set: { status: 'available' }, $unset: { soldTo: '', orderId: '', soldAt: '' } });
}

/** the purchased rows (cell arrays) in the order they were stored */
export async function getOrderRows(orderId: Types.ObjectId, userId?: Types.ObjectId): Promise<string[][]> {
  const filter: Record<string, unknown> = { orderId };
  if (userId) filter.soldTo = userId;
  const docs = await Item.find(filter).sort({ _id: 1 }).select('cells').lean();
  return docs.map((d) => d.cells);
}
