"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDb = connectDb;
exports.disconnectDb = disconnectDb;
const mongoose_1 = __importDefault(require("mongoose"));
const env_1 = require("./env");
const logger_1 = require("../utils/logger");
async function connectDb() {
    mongoose_1.default.set('strictQuery', true);
    mongoose_1.default.connection.on('disconnected', () => logger_1.logger.warn('MongoDB disconnected'));
    mongoose_1.default.connection.on('reconnected', () => logger_1.logger.info('MongoDB reconnected'));
    mongoose_1.default.connection.on('error', (e) => logger_1.logger.error({ msg: e.message }, 'MongoDB error'));
    await mongoose_1.default.connect(env_1.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000, maxPoolSize: 20 });
    // Make sure unique indexes exist before accepting traffic (they protect against double sales / reused TrxIDs)
    await Promise.all(Object.values(mongoose_1.default.models).map((m) => m.init()));
    logger_1.logger.info('MongoDB connected');
}
async function disconnectDb() {
    await mongoose_1.default.disconnect();
}
//# sourceMappingURL=db.js.map