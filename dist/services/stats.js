"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStats = getStats;
const User_1 = require("../models/User");
const Order_1 = require("../models/Order");
const Deposit_1 = require("../models/Deposit");
const inventory_1 = require("./inventory");
async function getStats() {
    const [stock, users, banned, dep, sales] = await Promise.all([
        (0, inventory_1.getStock)(),
        User_1.User.countDocuments(),
        User_1.User.countDocuments({ isBanned: true }),
        Deposit_1.Deposit.aggregate([{ $match: { status: 'verified' } }, { $group: { _id: null, n: { $sum: 1 }, sum: { $sum: '$verifiedAmount' } } }]),
        Order_1.Order.aggregate([{ $match: { status: 'completed' } }, { $group: { _id: null, n: { $sum: 1 }, emails: { $sum: '$quantity' }, sum: { $sum: '$total' } } }]),
    ]);
    return {
        stock,
        users,
        banned,
        deposits: { count: dep[0]?.n ?? 0, sum: dep[0]?.sum ?? 0 },
        sales: { orders: sales[0]?.n ?? 0, emails: sales[0]?.emails ?? 0, revenue: sales[0]?.sum ?? 0 },
    };
}
//# sourceMappingURL=stats.js.map