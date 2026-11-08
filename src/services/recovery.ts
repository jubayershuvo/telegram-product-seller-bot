import { Order } from '../models/Order';
import { rollbackOrder } from './purchase';
import { recoverStaleDeposits } from './deposit';
import { logger } from '../utils/logger';
import { safeError } from '../utils/errors';

/** Repairs anything a crash/restart left half-finished. Safe to run repeatedly. */
export async function recoverStale(): Promise<void> {
  try {
    const stale = await Order.find({ status: 'processing', createdAt: { $lt: new Date(Date.now() - 2 * 60_000) } }).select('_id');
    for (const o of stale) {
      await rollbackOrder(o._id, 'recovered after interruption');
      logger.warn({ order: o.id }, 'Rolled back stale order');
    }
    await recoverStaleDeposits();
  } catch (e) {
    logger.error({ err: safeError(e) }, 'Recovery job failed');
  }
}
