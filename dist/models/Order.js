"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Order = void 0;
const mongoose_1 = require("mongoose");
const schema = new mongoose_1.Schema({
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    telegramId: { type: Number, required: true },
    productId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Product', index: true },
    productName: { type: String, default: 'Product' },
    columns: { type: [String], default: [] },
    hasHeader: { type: Boolean, default: false },
    format: { type: String, enum: ['xlsx', 'csv'], default: 'xlsx' },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true },
    total: { type: Number, required: true },
    status: { type: String, enum: ['processing', 'completed', 'failed'], default: 'processing' },
    failReason: String,
    completedAt: Date,
}, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ userId: 1, createdAt: -1 });
schema.index({ status: 1, createdAt: 1 });
exports.Order = (0, mongoose_1.model)('Order', schema);
//# sourceMappingURL=Order.js.map