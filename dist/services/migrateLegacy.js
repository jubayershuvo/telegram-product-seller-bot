"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrateLegacyEmails = migrateLegacyEmails;
const mongoose_1 = __importDefault(require("mongoose"));
const Product_1 = require("../models/Product");
const Item_1 = require("../models/Item");
const Order_1 = require("../models/Order");
const ImportBatch_1 = require("../models/ImportBatch");
const Setting_1 = require("../models/Setting");
const dataFile_1 = require("./dataFile");
const logger_1 = require("../utils/logger");
/**
 * One-time upgrade from the old single-product bot.
 * Every document of the old `emails` collection becomes an Item of a product called "Emails"
 * (1 column, no header, delivered as .xlsx, exactly like the old files). Old orders / import batches are linked to it.
 * Safe to run on every start: it does nothing when there is no `emails` collection, and it is resumable
 * (upserts on (productId, key)); the old collection is renamed to `emails_migrated` only after everything copied.
 */
async function migrateLegacyEmails() {
    const db = mongoose_1.default.connection.db;
    if (!db)
        return;
    const exists = (await db.listCollections({ name: 'emails' }).toArray()).length > 0;
    if (!exists)
        return;
    const legacy = db.collection('emails');
    const count = await legacy.estimatedDocumentCount();
    if (count === 0) {
        await legacy.rename('emails_migrated').catch(() => undefined);
        return;
    }
    logger_1.logger.warn({ count }, 'Migrating legacy emails into a product…');
    // the old single-product bot kept its price in the `price` setting; it becomes this product's own price
    const stored = (await Setting_1.Setting.findOne({ key: 'price' }).lean())?.value;
    const price = typeof stored === 'number' && Number.isFinite(stored) && stored > 0 ? stored : 5;
    // ...and the old shop-wide `maxQty` cap becomes this product's own max per order
    const storedCap = (await Setting_1.Setting.findOne({ key: 'maxQty' }).lean())?.value;
    const maxQty = typeof storedCap === 'number' && Number.isInteger(storedCap) && storedCap > 0 ? storedCap : 0;
    let product = await Product_1.Product.findOne({ legacySource: 'emails' });
    if (!product) {
        // "Emails" may already be taken by a product the admin created before the first start of this version
        const taken = await Product_1.Product.exists({ nameKey: 'emails' });
        const name = taken ? 'Emails (old stock)' : 'Emails';
        product = await Product_1.Product.create({
            name,
            nameKey: name.toLowerCase(),
            price,
            maxQty,
            active: true,
            columnCount: 1,
            columns: ['A'],
            hasHeader: false,
            format: 'xlsx',
            legacySource: 'emails',
        });
    }
    let batch = [];
    const flush = async () => {
        if (!batch.length)
            return;
        await Item_1.Item.bulkWrite(batch, { ordered: false, timestamps: false }); // keep the original createdAt
        batch = [];
    };
    for await (const e of legacy.find({})) {
        const cells = [String(e.address)];
        const key = (0, dataFile_1.rowKey)(cells);
        batch.push({
            updateOne: {
                filter: { productId: product._id, key },
                update: {
                    $setOnInsert: {
                        productId: product._id,
                        key,
                        cells,
                        status: e.status === 'sold' ? 'sold' : 'available',
                        ...(e.soldTo && { soldTo: e.soldTo }),
                        ...(e.orderId && { orderId: e.orderId }),
                        ...(e.soldAt && { soldAt: e.soldAt }),
                        ...(e.batchId && { batchId: e.batchId }),
                        createdAt: e.createdAt ?? new Date(),
                    },
                },
                upsert: true,
            },
        });
        if (batch.length >= 1000)
            await flush();
    }
    await flush();
    const snapshot = { productId: product._id, productName: product.name, columns: product.columns, hasHeader: false, format: 'xlsx' };
    await Order_1.Order.updateMany({ productId: { $exists: false } }, { $set: snapshot });
    await ImportBatch_1.ImportBatch.updateMany({ productId: { $exists: false } }, { $set: { productId: product._id, productName: product.name } });
    await legacy.rename('emails_migrated');
    logger_1.logger.warn({ product: product.name }, 'Legacy emails migrated (old collection renamed to emails_migrated)');
}
//# sourceMappingURL=migrateLegacy.js.map