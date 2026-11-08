"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Broadcast = void 0;
const mongoose_1 = require("mongoose");
const schema = new mongoose_1.Schema({
    adminId: { type: Number, required: true },
    sourceChatId: { type: Number, required: true },
    sourceMessageId: { type: Number, required: true },
    total: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    blocked: { type: Number, default: 0 },
    status: { type: String, enum: ['running', 'completed', 'cancelled', 'interrupted'], default: 'running' },
    startedAt: { type: Date, default: Date.now },
    finishedAt: Date,
}, { timestamps: true });
exports.Broadcast = (0, mongoose_1.model)('Broadcast', schema);
//# sourceMappingURL=Broadcast.js.map