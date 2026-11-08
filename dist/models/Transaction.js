"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Transaction = void 0;
const mongoose_1 = require("mongoose");
const schema = new mongoose_1.Schema({
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    telegramId: { type: Number, required: true },
    type: { type: String, enum: ['deposit', 'purchase', 'refund', 'admin_credit', 'admin_debit'], required: true },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    refType: { type: String, enum: ['order', 'deposit'] },
    refId: mongoose_1.Schema.Types.ObjectId,
    note: String,
    opKey: { type: String, unique: true, sparse: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ userId: 1, createdAt: -1 });
schema.index({ createdAt: -1 });
exports.Transaction = (0, mongoose_1.model)('Transaction', schema);
//# sourceMappingURL=Transaction.js.map