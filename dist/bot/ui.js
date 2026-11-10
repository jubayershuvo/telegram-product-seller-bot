"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shortId = exports.mainMenu = exports.BTN = exports.stockLabel = exports.trunc = exports.LINE = exports.shopTitle = exports.shopLogo = exports.shopName = exports.esc = exports.HTML = void 0;
exports.editOrReply = editOrReply;
exports.commandArgs = commandArgs;
exports.userLabel = userLabel;
exports.setState = setState;
exports.clearState = clearState;
const telegraf_1 = require("telegraf");
const User_1 = require("../models/User");
const settings_1 = require("../services/settings");
const Setting_1 = require("../models/Setting");
exports.HTML = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
exports.esc = esc;
/** Shop name from settings, HTML-escaped, ready to drop into a message. */
const shopName = () => (0, exports.esc)((0, settings_1.getCachedSettings)().shopName?.trim() || Setting_1.SETTING_DEFAULTS.shopName);
exports.shopName = shopName;
/** Shop logo emoji from settings, HTML-escaped. Empty string = admin removed the logo. */
const shopLogo = () => {
    const logo = (0, settings_1.getCachedSettings)().shopLogo;
    return (0, exports.esc)(typeof logo === 'string' ? logo.trim() : Setting_1.SETTING_DEFAULTS.shopLogo);
};
exports.shopLogo = shopLogo;
/** "🏪 Digital Store" - logo + shop name, the header used on every screen. */
const shopTitle = () => [(0, exports.shopLogo)(), (0, exports.shopName)()].filter(Boolean).join(' ');
exports.shopTitle = shopTitle;
exports.LINE = '━━━━━━━━━━━━━━';
const trunc = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
exports.trunc = trunc;
/** "✅ 120 in stock" / "⚠️ Only 3 left" / "❌ Sold out" */
const stockLabel = (n) => (n <= 0 ? '❌ Sold out' : n <= 10 ? `⚠️ Only ${n} left` : `✅ ${n} in stock`);
exports.stockLabel = stockLabel;
exports.BTN = {
    balance: '💰 Balance',
    buy: '🛍 Shop',
    recharge: '➕ Recharge',
    orders: '📦 My Orders',
    tx: '🧾 Transactions',
    help: 'ℹ️ Help',
    admin: '🛠 Admin Panel',
};
const mainMenu = (isAdmin = false) => {
    const rows = [[exports.BTN.balance, exports.BTN.buy], [exports.BTN.recharge, exports.BTN.orders], [exports.BTN.tx, exports.BTN.help]];
    if (isAdmin)
        rows.push([exports.BTN.admin]);
    return telegraf_1.Markup.keyboard(rows).resize();
};
exports.mainMenu = mainMenu;
async function editOrReply(ctx, text, extra = {}) {
    if (ctx.callbackQuery) {
        try {
            await ctx.editMessageText(text, { ...exports.HTML, ...extra });
            return;
        }
        catch {
            /* message not modified / too old: fall through to a new message */
        }
    }
    await ctx.reply(text, { ...exports.HTML, ...extra });
}
function commandArgs(ctx) {
    const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') || '';
    return text.trim().split(/\s+/).slice(1);
}
function userLabel(u) {
    const name = (0, exports.esc)(u.firstName || 'User');
    const at = u.username ? ` @${(0, exports.esc)(u.username)}` : '';
    return `${name}${at} (<code>${u.telegramId}</code>)`;
}
async function setState(userId, name, data = {}) {
    await User_1.User.updateOne({ _id: userId }, { $set: { state: { name, data, at: new Date() } } });
}
async function clearState(userId) {
    await User_1.User.updateOne({ _id: userId }, { $unset: { state: 1 } });
}
const shortId = (id) => String(id).slice(-6).toUpperCase();
exports.shortId = shortId;
//# sourceMappingURL=ui.js.map