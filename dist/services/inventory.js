"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStock = getStock;
exports.reserveItems = reserveItems;
exports.releaseItems = releaseItems;
exports.getOrderRows = getOrderRows;
const Item_1 = require("../models/Item");
const catalog_1 = require("./catalog");
/** totals over ALL products */
async function getStock() {
    const total = { total: 0, available: 0, sold: 0 };
    for (const s of (await (0, catalog_1.getStockMap)()).values()) {
        total.total += s.total;
        total.available += s.available;
        total.sold += s.sold;
    }
    return total;
}
/**
 * Reserve (= mark as sold) `qty` items of ONE product for an order.
 * Every document is flipped with a filter on status:'available', which MongoDB applies atomically per document,
 * so two concurrent buyers can never receive the same row. Returns how many were actually reserved.
 */
async function reserveItems(orderId, userId, productId, qty) {
    let reserved = 0;
    for (let attempt = 0; attempt < 25 && reserved < qty; attempt++) {
        const candidates = await Item_1.Item.find({ productId, status: 'available' })
            .sort({ _id: 1 })
            .limit(qty - reserved)
            .select('_id')
            .lean();
        if (candidates.length === 0)
            break;
        const res = await Item_1.Item.updateMany({ _id: { $in: candidates.map((c) => c._id) }, status: 'available' }, { $set: { status: 'sold', soldTo: userId, orderId, soldAt: new Date() } });
        reserved += res.modifiedCount;
    }
    return reserved;
}
async function releaseItems(orderId) {
    await Item_1.Item.updateMany({ orderId, status: 'sold' }, { $set: { status: 'available' }, $unset: { soldTo: '', orderId: '', soldAt: '' } });
}
/** the purchased rows (cell arrays) in the order they were stored */
async function getOrderRows(orderId, userId) {
    const filter = { orderId };
    if (userId)
        filter.soldTo = userId;
    const docs = await Item_1.Item.find(filter).sort({ _id: 1 }).select('cells').lean();
    return docs.map((d) => d.cells);
}
//# sourceMappingURL=inventory.js.map