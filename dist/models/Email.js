"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Email = void 0;
const mongoose_1 = require("mongoose");
const schema = new mongoose_1.Schema({
    // unique index = an address can exist (and therefore be sold) only once
    address: { type: String, required: true, unique: true, trim: true },
    status: { type: String, enum: ['available', 'sold'], default: 'available' },
    soldTo: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    orderId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Order' },
    soldAt: Date,
    batchId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'ImportBatch' },
}, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ status: 1, _id: 1 });
schema.index({ orderId: 1 });
schema.index({ soldTo: 1 });
exports.Email = (0, mongoose_1.model)('Email', schema);
//# sourceMappingURL=Email.js.map