"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withUserLock = withUserLock;
const User_1 = require("../models/User");
const errors_1 = require("../utils/errors");
/**
 * Per-user mutex stored in MongoDB (works across restarts and multiple processes).
 * Prevents a user double-tapping "Confirm" or submitting two TrxIDs at once.
 */
async function withUserLock(userId, fn, ttlMs = 60_000) {
    const now = new Date();
    const got = await User_1.User.findOneAndUpdate({ _id: userId, $or: [{ lockUntil: null }, { lockUntil: { $lt: now } }] }, { $set: { lockUntil: new Date(now.getTime() + ttlMs) } });
    if (!got)
        throw new errors_1.AppError('⏳ Another request is still being processed. Please wait a moment.', 'LOCKED');
    try {
        return await fn();
    }
    finally {
        await User_1.User.updateOne({ _id: userId }, { $set: { lockUntil: null } }).catch(() => undefined);
    }
}
//# sourceMappingURL=userLock.js.map