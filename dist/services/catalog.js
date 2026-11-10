"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DESC_MAX = exports.NAME_MAX = void 0;
exports.getProduct = getProduct;
exports.createProduct = createProduct;
exports.renameProduct = renameProduct;
exports.setDescription = setDescription;
exports.limitsOf = limitsOf;
exports.buyRange = buyRange;
exports.describeLimits = describeLimits;
exports.parseLimits = parseLimits;
exports.setQtyLimits = setQtyLimits;
exports.setPrice = setPrice;
exports.getStockMap = getStockMap;
exports.getProductStock = getProductStock;
exports.isStructureLocked = isStructureLocked;
exports.checkStructure = checkStructure;
exports.importIntoProduct = importIntoProduct;
exports.clearUnsold = clearUnsold;
exports.deleteProduct = deleteProduct;
const mongoose_1 = require("mongoose");
const Product_1 = require("../models/Product");
const Item_1 = require("../models/Item");
const Order_1 = require("../models/Order");
const ImportBatch_1 = require("../models/ImportBatch");
const dataFile_1 = require("./dataFile");
const errors_1 = require("../utils/errors");
const money_1 = require("../utils/money");
exports.NAME_MAX = 80;
exports.DESC_MAX = 500;
const toKey = (name) => name.trim().toLowerCase();
async function getProduct(id) {
    return mongoose_1.Types.ObjectId.isValid(String(id)) ? Product_1.Product.findById(id) : null;
}
async function createProduct(nameRaw, price, description) {
    const name = nameRaw.trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > exports.NAME_MAX)
        throw new errors_1.AppError(`Product name must be 2–${exports.NAME_MAX} characters.`);
    if (!Number.isFinite(price) || price < 0 || (0, money_1.round2)(price) !== price)
        throw new errors_1.AppError('Invalid price.');
    const desc = (description ?? '').trim();
    if (desc.length > exports.DESC_MAX)
        throw new errors_1.AppError(`Description is too long (max ${exports.DESC_MAX} characters).`);
    try {
        return await Product_1.Product.create({ name, nameKey: toKey(name), price, ...(desc && { description: desc }) });
    }
    catch (e) {
        if ((0, errors_1.isDuplicateKeyError)(e))
            throw new errors_1.AppError('A product with this name already exists. Send a different name.');
        throw e;
    }
}
async function renameProduct(id, nameRaw) {
    const name = nameRaw.trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > exports.NAME_MAX)
        throw new errors_1.AppError(`Product name must be 2–${exports.NAME_MAX} characters.`);
    try {
        await Product_1.Product.updateOne({ _id: id }, { $set: { name, nameKey: toKey(name) } });
    }
    catch (e) {
        if ((0, errors_1.isDuplicateKeyError)(e))
            throw new errors_1.AppError('A product with this name already exists. Send a different name.');
        throw e;
    }
}
async function setDescription(id, text) {
    const d = text.trim();
    if (d.length > exports.DESC_MAX)
        throw new errors_1.AppError(`Description is too long (max ${exports.DESC_MAX} characters).`);
    await Product_1.Product.updateOne({ _id: id }, d ? { $set: { description: d } } : { $unset: { description: 1 } });
}
// ---------- per-product order limits ----------
/** Normalised limits of a product (works for lean documents and for old documents that lack the fields). */
function limitsOf(p) {
    const min = p.minQty && p.minQty > 1 ? Math.floor(p.minQty) : 1;
    const cap = p.maxQty && p.maxQty > 0 ? Math.floor(p.maxQty) : 0;
    return { min, cap };
}
/** What a buyer may order right now: stock capped by the product's own max. `buyable` is false when stock is below the minimum. */
function buyRange(p, available) {
    const { min, cap } = limitsOf(p);
    const max = cap > 0 ? Math.min(available, cap) : available;
    return { min, max, buyable: available > 0 && max >= min };
}
/** "min 5 • max 100" for buyers / admins, empty string when the product has no special limits. */
function describeLimits(p) {
    const { min, cap } = limitsOf(p);
    const parts = [];
    if (min > 1)
        parts.push(`min ${min}`);
    if (cap > 0)
        parts.push(`max ${cap}`);
    return parts.join(' • ');
}
/**
 * Admin input for the limits. Accepts `5 100`, `5-100`, `5,100`; a single number sets the maximum;
 * `-` resets to the defaults (min 1, no max). A max of 0 means "no cap".
 */
function parseLimits(text) {
    const t = text.trim().toLowerCase();
    if (['-', 'reset', 'none', 'default'].includes(t))
        return { min: 1, max: 0 };
    const nums = t.split(/[\s,;:\-–]+|to/).filter(Boolean);
    if (nums.length < 1 || nums.length > 2 || nums.some((n) => !/^\d{1,7}$/.test(n))) {
        return 'Send two whole numbers: minimum and maximum, e.g. 1 100. Use 0 as the maximum for no cap.';
    }
    const [a, b] = nums.map(Number);
    const [min, max] = nums.length === 1 ? [1, a] : [a, b];
    if (min < 1)
        return 'The minimum must be at least 1.';
    if (max > 0 && max < min)
        return 'The maximum cannot be lower than the minimum.';
    return { min, max };
}
async function setQtyLimits(id, min, max) {
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < 0 || (max > 0 && max < min))
        throw new errors_1.AppError('Invalid limits.');
    await Product_1.Product.updateOne({ _id: id }, { $set: { minQty: min, maxQty: max } });
}
async function setPrice(id, price) {
    if (!Number.isFinite(price) || price <= 0 || (0, money_1.round2)(price) !== price)
        throw new errors_1.AppError('Invalid price.');
    await Product_1.Product.updateOne({ _id: id }, { $set: { price } });
}
/** stock of every product in one query */
async function getStockMap() {
    const rows = await Item_1.Item.aggregate([
        { $group: { _id: { p: '$productId', s: '$status' }, n: { $sum: 1 } } },
    ]);
    const map = new Map();
    for (const r of rows) {
        const k = String(r._id.p);
        const cur = map.get(k) ?? { total: 0, available: 0, sold: 0 };
        if (r._id.s === 'available')
            cur.available += r.n;
        else
            cur.sold += r.n;
        cur.total += r.n;
        map.set(k, cur);
    }
    return map;
}
async function getProductStock(productId) {
    const [available, sold] = await Promise.all([
        Item_1.Item.countDocuments({ productId, status: 'available' }),
        Item_1.Item.countDocuments({ productId, status: 'sold' }),
    ]);
    return { total: available + sold, available, sold };
}
/** A product's structure is locked as soon as it holds any item (sold or not). */
async function isStructureLocked(productId) {
    return (await Item_1.Item.exists({ productId })) !== null;
}
/**
 * Splits a parsed file into header + data rows according to `hasHeader`, then either
 *  - defines the product's structure (product has no items yet), or
 *  - checks the file matches the existing structure (same column count and, with a header row, same header names).
 */
function checkStructure(product, sheet, hasHeader, locked) {
    const header = hasHeader ? (0, dataFile_1.headerNames)(sheet.rows[0]) : Array.from({ length: sheet.width }, (_, i) => (0, dataFile_1.columnLabel)(i));
    const data = hasHeader ? sheet.rows.slice(1) : sheet.rows;
    if (data.length === 0)
        throw new errors_1.AppError('The file has a header row but no data rows below it.');
    if (locked) {
        if (sheet.width !== product.columnCount) {
            throw new errors_1.AppError(`❌ This file has ${sheet.width} column(s) but this product's structure has ${product.columnCount}.\nUpload a file with the same columns, or create a separate product.`);
        }
        if (product.hasHeader) {
            const same = header.every((h, i) => (0, dataFile_1.normHeader)(h) === (0, dataFile_1.normHeader)(product.columns[i] ?? ''));
            if (!same) {
                throw new errors_1.AppError(`❌ The header row does not match this product.\nExpected: ${product.columns.join(' | ')}\nFound: ${header.join(' | ')}`);
            }
        }
    }
    return { header, data };
}
async function importIntoProduct(productId, sheet, hasHeader, fileName, adminTelegramId) {
    const product = await Product_1.Product.findById(productId);
    if (!product)
        throw new errors_1.AppError('Product not found.');
    const locked = await isStructureLocked(productId);
    const effectiveHeader = locked ? product.hasHeader : hasHeader;
    const { header, data } = checkStructure(product, sheet, effectiveHeader, locked);
    const seen = new Map();
    let dupInFile = 0;
    for (const cells of data) {
        const key = (0, dataFile_1.rowKey)(cells);
        if (seen.has(key))
            dupInFile++;
        else
            seen.set(key, cells);
    }
    if (!locked) {
        await Product_1.Product.updateOne({ _id: productId }, { $set: { columnCount: sheet.width, columns: header, hasHeader: effectiveHeader, format: sheet.format } });
    }
    const batchId = new mongoose_1.Types.ObjectId();
    const entries = [...seen.entries()];
    let inserted = 0;
    const CHUNK = 1000;
    for (let i = 0; i < entries.length; i += CHUNK) {
        // upsert with $setOnInsert: existing rows are never touched (a sold row can never become available again)
        const res = await Item_1.Item.bulkWrite(entries.slice(i, i + CHUNK).map(([key, cells]) => ({
            updateOne: {
                filter: { productId, key },
                update: { $setOnInsert: { productId, key, cells, status: 'available', batchId } },
                upsert: true,
            },
        })), { ordered: false });
        inserted += res.upsertedCount;
    }
    const report = {
        totalRows: data.length,
        duplicatesInFile: dupInFile,
        duplicatesInDb: entries.length - inserted,
        inserted,
        structureDefined: !locked,
    };
    await ImportBatch_1.ImportBatch.create({
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
async function clearUnsold(productId) {
    const res = await Item_1.Item.deleteMany({ productId, status: 'available' });
    return res.deletedCount ?? 0;
}
/** A product that has sales history can only be hidden, never deleted (orders keep pointing at it). */
async function deleteProduct(productId) {
    const [sold, orders] = await Promise.all([Item_1.Item.exists({ productId, status: 'sold' }), Order_1.Order.exists({ productId })]);
    if (sold || orders)
        throw new errors_1.AppError('This product already has sales, so it cannot be deleted. Hide it instead (👁 Hide).');
    await Item_1.Item.deleteMany({ productId });
    await Product_1.Product.deleteOne({ _id: productId });
}
//# sourceMappingURL=catalog.js.map