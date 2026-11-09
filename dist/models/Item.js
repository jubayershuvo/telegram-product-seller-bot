"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Item = void 0;
const mongoose_1 = require("mongoose");
const schema = new mongoose_1.Schema({
    productId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Product', required: true },
    key: { type: String, required: true },
    cells: { type: [String], default: [] },
    status: { type: String, enum: ['available', 'sold'], default: 'available' },
    soldTo: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    orderId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Order' },
    soldAt: Date,
    batchId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'ImportBatch' },
}, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ productId: 1, key: 1 }, { unique: true });
schema.index({ productId: 1, status: 1, _id: 1 });
schema.index({ orderId: 1 });
schema.index({ soldTo: 1 });
exports.Item = (0, mongoose_1.model)('Item', schema);
//# sourceMappingURL=Item.js.map