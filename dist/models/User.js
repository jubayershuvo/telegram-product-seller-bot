"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.User = void 0;
const mongoose_1 = require("mongoose");
const schema = new mongoose_1.Schema({
    telegramId: { type: Number, required: true, unique: true, index: true },
    username: String,
    firstName: String,
    lastName: String,
    balance: { type: Number, default: 0, min: 0 },
    totalDeposited: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
    isBanned: { type: Boolean, default: false },
    botBlocked: { type: Boolean, default: false },
    state: {
        name: String,
        data: mongoose_1.Schema.Types.Mixed,
        at: Date,
    },
    ops: { type: [String], default: [] },
    lockUntil: { type: Date, default: null },
    lastSeenAt: Date,
}, { timestamps: true });
exports.User = (0, mongoose_1.model)('User', schema);
//# sourceMappingURL=User.js.map