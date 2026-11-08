"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Channel = void 0;
const mongoose_1 = require("mongoose");
const schema = new mongoose_1.Schema({
    chatId: { type: Number, required: true, unique: true, index: true },
    type: { type: String, default: 'channel' },
    title: { type: String, required: true },
    username: String,
    inviteLink: String,
    addedBy: Number,
}, { timestamps: true });
exports.Channel = (0, mongoose_1.model)('Channel', schema);
//# sourceMappingURL=Channel.js.map