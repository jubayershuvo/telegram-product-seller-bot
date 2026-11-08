"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Deposit = void 0;
const mongoose_1 = require("mongoose");
const schema = new mongoose_1.Schema({
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    telegramId: { type: Number, required: true },
    method: { type: String, enum: ['bkash', 'nagad'], required: true },
    trxId: { type: String, required: true, uppercase: true, trim: true },
    claimedAmount: { type: Number, default: 0 },
    verifiedAmount: Number,
    status: { type: String, enum: ['processing', 'verified', 'failed'], default: 'processing' },
    locked: { type: Boolean, default: true },
    failReason: String,
    rawResponse: String,
}, { timestamps: { createdAt: true, updatedAt: false } });
// A TrxID can be used exactly once (failed attempts release the lock so a user can retry)
schema.index({ trxId: 1 }, { unique: true, partialFilterExpression: { locked: true } });
schema.index({ userId: 1, createdAt: -1 });
schema.index({ status: 1, createdAt: 1 });
exports.Deposit = (0, mongoose_1.model)('Deposit', schema);
//# sourceMappingURL=Deposit.js.map