"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImportBatch = void 0;
const mongoose_1 = require("mongoose");
const schema = new mongoose_1.Schema({
    adminTelegramId: { type: Number, required: true },
    fileName: { type: String, required: true },
    totalRows: Number,
    invalidRows: Number,
    duplicatesInFile: Number,
    duplicatesInDb: Number,
    inserted: Number,
}, { timestamps: { createdAt: true, updatedAt: false } });
exports.ImportBatch = (0, mongoose_1.model)('ImportBatch', schema);
//# sourceMappingURL=ImportBatch.js.map