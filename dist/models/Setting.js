"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Setting = exports.SETTING_DEFS = exports.SETTING_DEFAULTS = void 0;
const mongoose_1 = require("mongoose");
exports.SETTING_DEFAULTS = {
    currencySymbol: '৳',
    timezone: 'Asia/Dhaka',
    price: 5,
    maxQty: 0,
    support: '',
    rechargeEnabled: true,
    rechargeScheduleEnabled: false,
    rechargeOpenTime: '09:00',
    rechargeCloseTime: '22:00',
    bkashNumber: '',
    nagadNumber: '',
    minRecharge: 50,
    maxRecharge: 10000,
    rechargePresets: [50, 100, 200, 500, 1000],
    forceJoinEnabled: true,
    maxUploadMb: 15,
    trxIdRegex: '^[A-Za-z0-9]{8,14}$',
    maxFailedTrxPerHour: 5,
};
exports.SETTING_DEFS = [
    { key: 'currencySymbol', type: 'string', group: 'Shop', hint: 'e.g. ৳' },
    { key: 'timezone', type: 'timezone', group: 'Shop', hint: 'IANA name, e.g. Asia/Dhaka' },
    { key: 'price', type: 'money', group: 'Shop', hint: 'default price for NEW products (each product has its own price)' },
    { key: 'maxQty', type: 'int', group: 'Shop', hint: 'max items per order, 0 = limited only by stock', min: 0, max: 10_000_000 },
    { key: 'support', type: 'string', group: 'Shop', hint: '@username or link' },
    { key: 'rechargeEnabled', type: 'bool', group: 'Recharge', hint: 'master switch: true = recharge open, false = closed for all users' },
    { key: 'rechargeScheduleEnabled', type: 'bool', group: 'Recharge', hint: 'true = recharge only open during the daily hours below' },
    { key: 'rechargeOpenTime', type: 'time', group: 'Recharge', hint: 'daily opening time, HH:mm (24h), e.g. 09:00' },
    { key: 'rechargeCloseTime', type: 'time', group: 'Recharge', hint: 'daily closing time, HH:mm (24h), e.g. 22:00' },
    { key: 'bkashNumber', type: 'string', group: 'Recharge', hint: 'bKash receiving number' },
    { key: 'nagadNumber', type: 'string', group: 'Recharge', hint: 'Nagad receiving number' },
    { key: 'minRecharge', type: 'money', group: 'Recharge', hint: 'minimum recharge' },
    { key: 'maxRecharge', type: 'money', group: 'Recharge', hint: 'maximum recharge' },
    { key: 'rechargePresets', type: 'numlist', group: 'Recharge', hint: 'quick amounts, e.g. 50,100,200' },
    { key: 'forceJoinEnabled', type: 'bool', group: 'Force Join', hint: 'true = users must join all required channels before using the bot' },
    { key: 'maxUploadMb', type: 'int', group: 'Uploads', hint: 'max .xlsx / .csv upload size in MB (Telegram limit 20)', min: 1, max: 20 },
    { key: 'trxIdRegex', type: 'regex', group: 'TrxID', hint: 'regular expression a TrxID must match' },
    { key: 'maxFailedTrxPerHour', type: 'int', group: 'TrxID', hint: 'failed attempts per user per hour', min: 1, max: 1000 },
];
const schema = new mongoose_1.Schema({
    key: { type: String, required: true, unique: true },
    value: mongoose_1.Schema.Types.Mixed,
}, { timestamps: true, minimize: false });
exports.Setting = (0, mongoose_1.model)('Setting', schema);
//# sourceMappingURL=Setting.js.map