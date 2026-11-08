"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.maxBuyable = void 0;
exports.getStock = getStock;
exports.reserveEmails = reserveEmails;
exports.releaseEmails = releaseEmails;
exports.getOrderEmails = getOrderEmails;
const Email_1 = require("../models/Email");
async function getStock() {
    const [total, available] = await Promise.all([Email_1.Email.countDocuments(), Email_1.Email.countDocuments({ status: 'available' })]);
    return { total, available, sold: total - available };
}
/** Highest quantity a user may order: what is in stock, optionally capped by the admin `maxQty` setting (0 = no cap). */
const maxBuyable = (available, maxQty) => (maxQty > 0 ? Math.min(available, maxQty) : available);
exports.maxBuyable = maxBuyable;
/**
 * Reserve (= mark as sold) `qty` emails for an order.
 * Every document is flipped with a filter on status:'available', which MongoDB applies atomically per document,
 * so two concurrent buyers can never receive the same address. Returns how many were actually reserved.
 */
async function reserveEmails(orderId, userId, qty) {
    let reserved = 0;
    for (let attempt = 0; attempt < 25 && reserved < qty; attempt++) {
        const candidates = await Email_1.Email.find({ status: 'available' })
            .sort({ _id: 1 })
            .limit(qty - reserved)
            .select('_id')
            .lean();
        if (candidates.length === 0)
            break;
        const res = await Email_1.Email.updateMany({ _id: { $in: candidates.map((c) => c._id) }, status: 'available' }, { $set: { status: 'sold', soldTo: userId, orderId, soldAt: new Date() } });
        reserved += res.modifiedCount;
    }
    return reserved;
}
async function releaseEmails(orderId) {
    await Email_1.Email.updateMany({ orderId, status: 'sold' }, { $set: { status: 'available' }, $unset: { soldTo: '', orderId: '', soldAt: '' } });
}
async function getOrderEmails(orderId, userId) {
    const filter = { orderId };
    if (userId)
        filter.soldTo = userId;
    const docs = await Email_1.Email.find(filter).sort({ _id: 1 }).select('address').lean();
    return docs.map((d) => d.address);
}
//# sourceMappingURL=inventory.js.map