import { Setting } from '../models/Setting';
import { Product } from '../models/Product';
import { logger } from '../utils/logger';

const OBSOLETE = ['price', 'maxQty'];

/**
 * One-time cleanup after the move to full multi-product mode.
 * `price` and `maxQty` used to be shop-wide settings; they now belong to each product.
 *  - products without limits get minQty = 1 and maxQty = the old global cap (0 = no cap)
 *  - the obsolete setting documents are deleted
 * Safe to run on every start (does nothing once everything is migrated).
 * Must run AFTER migrateLegacyEmails(), which still reads the old `price` document.
 */
export async function migrateObsoleteSettings(): Promise<void> {
  const docs = await Setting.find({ key: { $in: OBSOLETE } }).lean();
  const old = docs.find((d) => d.key === 'maxQty')?.value;
  const cap = typeof old === 'number' && Number.isInteger(old) && old > 0 ? old : 0;

  const [a, b] = await Promise.all([
    Product.updateMany({ maxQty: { $exists: false } }, { $set: { maxQty: cap } }),
    Product.updateMany({ minQty: { $exists: false } }, { $set: { minQty: 1 } }),
  ]);
  if (docs.length) {
    await Setting.deleteMany({ key: { $in: OBSOLETE } });
    logger.warn({ removed: docs.map((d) => d.key), productsUpdated: Math.max(a.modifiedCount, b.modifiedCount), cap }, 'Removed shop-wide price / maxQty settings (now per product)');
  }
}
