"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStats = getStats;
exports.getProductSales = getProductSales;
const User_1 = require("../models/User");
const Order_1 = require("../models/Order");
const Deposit_1 = require("../models/Deposit");
const Product_1 = require("../models/Product");
const catalog_1 = require("./catalog");
const DAY_MS = 24 * 60 * 60 * 1000;
async function getStats() {
    const [stockMap, products, users, banned, dep, sales, byProduct, last24h] = await Promise.all([
        (0, catalog_1.getStockMap)(),
        Product_1.Product.find().sort({ name: 1 }).select('name price active').lean(),
        User_1.User.countDocuments(),
        User_1.User.countDocuments({ isBanned: true }),
        Deposit_1.Deposit.aggregate([{ $match: { status: 'verified' } }, { $group: { _id: null, n: { $sum: 1 }, sum: { $sum: '$verifiedAmount' } } }]),
        Order_1.Order.aggregate([{ $match: { status: 'completed' } }, { $group: { _id: null, n: { $sum: 1 }, items: { $sum: '$quantity' }, sum: { $sum: '$total' } } }]),
        Order_1.Order.aggregate([{ $match: { status: 'completed' } }, { $group: { _id: '$productId', orders: { $sum: 1 }, revenue: { $sum: '$total' } } }]),
        Order_1.Order.aggregate([
            { $match: { status: 'completed', createdAt: { $gte: new Date(Date.now() - DAY_MS) } } },
            { $group: { _id: null, n: { $sum: 1 }, items: { $sum: '$quantity' }, sum: { $sum: '$total' } } },
        ]),
    ]);
    const salesOf = new Map(byProduct.map((r) => [String(r._id), { orders: r.orders, revenue: r.revenue }]));
    const perProduct = products.map((p) => ({
        id: String(p._id),
        name: p.name,
        price: p.price,
        active: p.active,
        ...(stockMap.get(String(p._id)) ?? { total: 0, available: 0, sold: 0 }),
        ...(salesOf.get(String(p._id)) ?? { orders: 0, revenue: 0 }),
    }));
    const stock = perProduct.reduce((a, p) => ({ total: a.total + p.total, available: a.available + p.available, sold: a.sold + p.sold }), { total: 0, available: 0, sold: 0 });
    return {
        stock,
        perProduct,
        users,
        banned,
        deposits: { count: dep[0]?.n ?? 0, sum: dep[0]?.sum ?? 0 },
        sales: { orders: sales[0]?.n ?? 0, items: sales[0]?.items ?? 0, revenue: sales[0]?.sum ?? 0 },
        last24h: { orders: last24h[0]?.n ?? 0, items: last24h[0]?.items ?? 0, revenue: last24h[0]?.sum ?? 0 },
    };
}
/** Revenue / sales of ONE product (product card in the admin panel). */
async function getProductSales(productId) {
    const r = await Order_1.Order.aggregate([
        { $match: { productId, status: 'completed' } },
        { $group: { _id: null, n: { $sum: 1 }, items: { $sum: '$quantity' }, sum: { $sum: '$total' } } },
    ]);
    return { orders: r[0]?.n ?? 0, items: r[0]?.items ?? 0, revenue: r[0]?.sum ?? 0 };
}
//# sourceMappingURL=stats.js.map