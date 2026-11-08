"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recoverStale = recoverStale;
const Order_1 = require("../models/Order");
const purchase_1 = require("./purchase");
const deposit_1 = require("./deposit");
const logger_1 = require("../utils/logger");
const errors_1 = require("../utils/errors");
/** Repairs anything a crash/restart left half-finished. Safe to run repeatedly. */
async function recoverStale() {
    try {
        const stale = await Order_1.Order.find({ status: 'processing', createdAt: { $lt: new Date(Date.now() - 2 * 60_000) } }).select('_id');
        for (const o of stale) {
            await (0, purchase_1.rollbackOrder)(o._id, 'recovered after interruption');
            logger_1.logger.warn({ order: o.id }, 'Rolled back stale order');
        }
        await (0, deposit_1.recoverStaleDeposits)();
    }
    catch (e) {
        logger_1.logger.error({ err: (0, errors_1.safeError)(e) }, 'Recovery job failed');
    }
}
//# sourceMappingURL=recovery.js.map