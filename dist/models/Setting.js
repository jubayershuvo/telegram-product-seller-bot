"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Setting = exports.SETTING_DEFS = exports.SETTING_DEFAULTS = void 0;
const mongoose_1 = require("mongoose");
exports.SETTING_DEFAULTS = {
    shopLogo: '🏪',
    shopLogoMedia: '',
    shopName: 'Digital Store',
    currencySymbol: '৳',
    timezone: 'Asia/Dhaka',
    support: '',
    lowStockAlert: 5,
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
    { key: 'shopLogo', type: 'string', group: 'Shop', label: 'Shop logo', hint: 'any emoji shown before the shop name everywhere, e.g. 🏪 🛒 🔥. Send - to remove it', max: 32, hidden: true },
    { key: 'shopLogoMedia', type: 'json', group: 'Shop', label: 'Shop logo image', hint: 'logo image / GIF / sticker (use the Shop logo editor)', hidden: true },
    { key: 'shopName', type: 'string', group: 'Shop', label: 'Shop name', hint: 'shown to customers, e.g. Digital Store', max: 40 },
    { key: 'currencySymbol', type: 'string', group: 'Shop', label: 'Currency symbol', hint: 'e.g. ৳', max: 5 },
    { key: 'timezone', type: 'timezone', group: 'Shop', label: 'Timezone', hint: 'IANA name, e.g. Asia/Dhaka' },
    { key: 'support', type: 'string', group: 'Shop', label: 'Support contact', hint: '@username or link' },
    { key: 'lowStockAlert', type: 'int', group: 'Shop', label: 'Low-stock alert at', hint: 'alert admins when a product has this many items left or fewer, 0 = off', min: 0, max: 1_000_000 },
    { key: 'rechargeEnabled', type: 'bool', group: 'Recharge', label: 'Recharge enabled', hint: 'master switch: true = recharge open, false = closed for all users' },
    { key: 'rechargeScheduleEnabled', type: 'bool', group: 'Recharge', label: 'Daily schedule', hint: 'true = recharge only open during the daily hours below' },
    { key: 'rechargeOpenTime', type: 'time', group: 'Recharge', label: 'Opens at', hint: 'daily opening time, HH:mm (24h), e.g. 09:00' },
    { key: 'rechargeCloseTime', type: 'time', group: 'Recharge', label: 'Closes at', hint: 'daily closing time, HH:mm (24h), e.g. 22:00' },
    { key: 'bkashNumber', type: 'string', group: 'Recharge', label: 'bKash number', hint: 'bKash receiving number' },
    { key: 'nagadNumber', type: 'string', group: 'Recharge', label: 'Nagad number', hint: 'Nagad receiving number' },
    { key: 'minRecharge', type: 'money', group: 'Recharge', label: 'Minimum recharge', hint: 'minimum recharge' },
    { key: 'maxRecharge', type: 'money', group: 'Recharge', label: 'Maximum recharge', hint: 'maximum recharge' },
    { key: 'rechargePresets', type: 'numlist', group: 'Recharge', label: 'Quick amounts', hint: 'quick amounts, e.g. 50,100,200' },
    { key: 'forceJoinEnabled', type: 'bool', group: 'Force Join', label: 'Force join', hint: 'true = users must join all required channels before using the bot' },
    { key: 'maxUploadMb', type: 'int', group: 'Uploads', label: 'Max upload size (MB)', hint: 'max .xlsx / .csv upload size in MB (Telegram limit 20)', min: 1, max: 20 },
    { key: 'trxIdRegex', type: 'regex', group: 'TrxID', label: 'TrxID pattern', hint: 'regular expression a TrxID must match' },
    { key: 'maxFailedTrxPerHour', type: 'int', group: 'TrxID', label: 'Failed TrxID limit / hour', hint: 'failed attempts per user per hour', min: 1, max: 1000 },
];
const schema = new mongoose_1.Schema({
    key: { type: String, required: true, unique: true },
    value: mongoose_1.Schema.Types.Mixed,
}, { timestamps: true, minimize: false });
exports.Setting = (0, mongoose_1.model)('Setting', schema);
//# sourceMappingURL=Setting.js.map