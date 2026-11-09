"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Product = void 0;
const mongoose_1 = require("mongoose");
const schema = new mongoose_1.Schema({
    name: { type: String, required: true, trim: true, maxlength: 80 },
    nameKey: { type: String, required: true, unique: true },
    description: { type: String, trim: true, maxlength: 500 },
    price: { type: Number, required: true, min: 0 },
    active: { type: Boolean, default: true },
    columnCount: { type: Number, default: 0 },
    columns: { type: [String], default: [] },
    hasHeader: { type: Boolean, default: false },
    format: { type: String, enum: ['xlsx', 'csv'], default: 'xlsx' },
    legacySource: { type: String, index: true, sparse: true },
}, { timestamps: true });
schema.index({ active: 1, name: 1 });
exports.Product = (0, mongoose_1.model)('Product', schema);
//# sourceMappingURL=Product.js.map