import { Types } from 'mongoose';
import { Email } from '../models/Email';

export async function getStock() {
  const [total, available] = await Promise.all([Email.countDocuments(), Email.countDocuments({ status: 'available' })]);
  return { total, available, sold: total - available };
}

/** Highest quantity a user may order: what is in stock, optionally capped by the admin `maxQty` setting (0 = no cap). */
export const maxBuyable = (available: number, maxQty: number): number => (maxQty > 0 ? Math.min(available, maxQty) : available);

/**
 * Reserve (= mark as sold) `qty` emails for an order.
 * Every document is flipped with a filter on status:'available', which MongoDB applies atomically per document,
 * so two concurrent buyers can never receive the same address. Returns how many were actually reserved.
 */
export async function reserveEmails(orderId: Types.ObjectId, userId: Types.ObjectId, qty: number): Promise<number> {
  let reserved = 0;
  for (let attempt = 0; attempt < 25 && reserved < qty; attempt++) {
    const candidates = await Email.find({ status: 'available' })
      .sort({ _id: 1 })
      .limit(qty - reserved)
      .select('_id')
      .lean();
    if (candidates.length === 0) break;
    const res = await Email.updateMany(
      { _id: { $in: candidates.map((c) => c._id) }, status: 'available' },
      { $set: { status: 'sold', soldTo: userId, orderId, soldAt: new Date() } },
    );
    reserved += res.modifiedCount;
  }
  return reserved;
}

export async function releaseEmails(orderId: Types.ObjectId): Promise<void> {
  await Email.updateMany(
    { orderId, status: 'sold' },
    { $set: { status: 'available' }, $unset: { soldTo: '', orderId: '', soldAt: '' } },
  );
}

export async function getOrderEmails(orderId: Types.ObjectId, userId?: Types.ObjectId): Promise<string[]> {
  const filter: Record<string, unknown> = { orderId };
  if (userId) filter.soldTo = userId;
  const docs = await Email.find(filter).sort({ _id: 1 }).select('address').lean();
  return docs.map((d) => d.address);
}
