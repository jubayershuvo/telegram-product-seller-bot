"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppError = void 0;
exports.isDuplicateKeyError = isDuplicateKeyError;
exports.safeError = safeError;
const axios_1 = __importDefault(require("axios"));
/** Error whose message is safe to show to the end user. */
class AppError extends Error {
    code;
    constructor(message, code = 'APP_ERROR') {
        super(message);
        this.code = code;
        this.name = 'AppError';
    }
}
exports.AppError = AppError;
function isDuplicateKeyError(e) {
    return typeof e === 'object' && e !== null && e.code === 11000;
}
/** Never log raw axios errors: their config/URL can contain the bot token or API keys. */
function safeError(e) {
    if (axios_1.default.isAxiosError(e)) {
        return { message: e.message, code: e.code, status: e.response?.status };
    }
    if (e instanceof Error)
        return { name: e.name, message: e.message, stack: e.stack };
    return { message: String(e) };
}
//# sourceMappingURL=errors.js.map