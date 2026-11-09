import { Types } from 'mongoose';
import { Product, ProductDoc } from '../models/Product';
import { Item } from '../models/Item';
import { Order } from '../models/Order';
import { ImportBatch } from '../models/ImportBatch';
import { ParsedSheet, columnLabel, headerNames, normHeader, rowKey } from './dataFile';
import { AppError, isDuplicateKeyError } from '../utils/errors';
import { round2 } from '../utils/money';

export const NAME_MAX = 80;
export const DESC_MAX = 500;

const toKey = (name: string) => name.trim().toLowerCase();

export async function getProduct(id: string | Types.ObjectId): Promise<ProductDoc | null> {
  return Types.ObjectId.isValid(String(id)) ? Product.findById(id) : null;
}

export async function createProduct(nameRaw: string, price: number, description?: string): Promise<ProductDoc> {
  const name = nameRaw.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > NAME_MAX) throw new AppError(`Product name must be 2–${NAME_MAX} characters.`);
  if (!Number.isFinite(price) || price < 0 || round2(price) !== price) throw new AppError('Invalid price.');
  const desc = (description ?? '').trim();
  if (desc.length > DESC_MAX) throw new AppError(`Description is too long (max ${DESC_MAX} characters).`);
  try {
    return await Product.create({ name, nameKey: toKey(name), price, ...(desc && { description: desc }) });
  } catch (e) {
    if (isDuplicateKeyError(e)) throw new AppError('A product with this name already exists. Send a different name.');
    throw e;
  }
}

export async function renameProduct(id: Types.ObjectId, nameRaw: string): Promise<void> {
  const name = nameRaw.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > NAME_MAX) throw new AppError(`Product name must be 2–${NAME_MAX} characters.`);
  try {
    await Product.updateOne({ _id: id }, { $set: { name, nameKey: toKey(name) } });
  } catch (e) {
    if (isDuplicateKeyError(e)) throw new AppError('A product with this name already exists. Send a different name.');
    throw e;
  }
}

export async function setDescription(id: Types.ObjectId, text: string): Promise<void> {
  const d = text.trim();
  if (d.length > DESC_MAX) throw new AppError(`Description is too long (max ${DESC_MAX} characters).`);
  await Product.updateOne({ _id: id }, d ? { $set: { description: d } } : { $unset: { description: 1 } });
}

// ---------- stock ----------
export interface Stock {
  total: number;
  available: number;
  sold: number;
}

/** stock of every product in one query */
export async function getStockMap(): Promise<Map<string, Stock>> {
  const rows = await Item.aggregate<{ _id: { p: Types.ObjectId; s: string }; n: number }>([
    { $group: { _id: { p: '$productId', s: '$status' }, n: { $sum: 1 } } },
  ]);
  const map = new Map<string, Stock>();
  for (const r of rows) {
    const k = String(r._id.p);
    const cur = map.get(k) ?? { total: 0, available: 0, sold: 0 };
    if (r._id.s === 'available') cur.available += r.n;
    else cur.sold += r.n;
    cur.total += r.n;
    map.set(k, cur);
  }
  return map;
}

export async function getProductStock(productId: Types.ObjectId): Promise<Stock> {
  const [available, sold] = await Promise.all([
    Item.countDocuments({ productId, status: 'available' }),
    Item.countDocuments({ productId, status: 'sold' }),
  ]);
  return { total: available + sold, available, sold };
}

// ---------- import ----------
export interface ImportReport {
  totalRows: number;
  duplicatesInFile: number;
  duplicatesInDb: number;
  inserted: number;
  structureDefined: boolean;
}

/** A product's structure is locked as soon as it holds any item (sold or not). */
export async function isStructureLocked(productId: Types.ObjectId): Promise<boolean> {
  return (await Item.exists({ productId })) !== null;
}

/**
 * Splits a parsed file into header + data rows according to `hasHeader`, then either
 *  - defines the product's structure (product has no items yet), or
 *  - checks the file matches the existing structure (same column count and, with a header row, same header names).
 */
export function checkStructure(
  product: Pick<ProductDoc, 'columnCount' | 'columns' | 'hasHeader'>,
  sheet: ParsedSheet,
  hasHeader: boolean,
  locked: boolean,
): { header: string[]; data: string[][] } {
  const header = hasHeader ? headerNames(sheet.rows[0]) : Array.from({ length: sheet.width }, (_, i) => columnLabel(i));
  const data = hasHeader ? sheet.rows.slice(1) : sheet.rows;
  if (data.length === 0) throw new AppError('The file has a header row but no data rows below it.');

  if (locked) {
    if (sheet.width !== product.columnCount) {
      throw new AppError(
        `❌ This file has ${sheet.width} column(s) but this product's structure has ${product.columnCount}.\nUpload a file with the same columns, or create a separate product.`,
      );
    }
    if (product.hasHeader) {
      const same = header.every((h, i) => normHeader(h) === normHeader(product.columns[i] ?? ''));
      if (!same) {
        throw new AppError(
          `❌ The header row does not match this product.\nExpected: ${product.columns.join(' | ')}\nFound: ${header.join(' | ')}`,
        );
      }
    }
  }
  return { header, data };
}

export async function importIntoProduct(
  productId: Types.ObjectId,
  sheet: ParsedSheet,
  hasHeader: boolean,
  fileName: string,
  adminTelegramId: number,
): Promise<ImportReport> {
  const product = await Product.findById(productId);
  if (!product) throw new AppError('Product not found.');
  const locked = await isStructureLocked(productId);
  const effectiveHeader = locked ? product.hasHeader : hasHeader;
  const { header, data } = checkStructure(product, sheet, effectiveHeader, locked);

  const seen = new Map<string, string[]>();
  let dupInFile = 0;
  for (const cells of data) {
    const key = rowKey(cells);
    if (seen.has(key)) dupInFile++;
    else seen.set(key, cells);
  }

  if (!locked) {
    await Product.updateOne(
      { _id: productId },
      { $set: { columnCount: sheet.width, columns: header, hasHeader: effectiveHeader, format: sheet.format } },
    );
  }

  const batchId = new Types.ObjectId();
  const entries = [...seen.entries()];
  let inserted = 0;
  const CHUNK = 1000;
  for (let i = 0; i < entries.length; i += CHUNK) {
    // upsert with $setOnInsert: existing rows are never touched (a sold row can never become available again)
    const res = await Item.bulkWrite(
      entries.slice(i, i + CHUNK).map(([key, cells]) => ({
        updateOne: {
          filter: { productId, key },
          update: { $setOnInsert: { productId, key, cells, status: 'available' as const, batchId } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    inserted += res.upsertedCount;
  }

  const report: ImportReport = {
    totalRows: data.length,
    duplicatesInFile: dupInFile,
    duplicatesInDb: entries.length - inserted,
    inserted,
    structureDefined: !locked,
  };
  await ImportBatch.create({
    _id: batchId,
    adminTelegramId,
    productId,
    productName: product.name,
    fileName,
    totalRows: report.totalRows,
    duplicatesInFile: report.duplicatesInFile,
    duplicatesInDb: report.duplicatesInDb,
    inserted: report.inserted,
  });
  return report;
}

// ---------- maintenance ----------
/** removes every item that has not been sold yet (e.g. after uploading into the wrong product) */
export async function clearUnsold(productId: Types.ObjectId): Promise<number> {
  const res = await Item.deleteMany({ productId, status: 'available' });
  return res.deletedCount ?? 0;
}

/** A product that has sales history can only be hidden, never deleted (orders keep pointing at it). */
export async function deleteProduct(productId: Types.ObjectId): Promise<void> {
  const [sold, orders] = await Promise.all([Item.exists({ productId, status: 'sold' }), Order.exists({ productId })]);
  if (sold || orders) throw new AppError('This product already has sales, so it cannot be deleted. Hide it instead (👁 Hide).');
  await Item.deleteMany({ productId });
  await Product.deleteOne({ _id: productId });
}
