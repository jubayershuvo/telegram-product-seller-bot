"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildGate = buildGate;
const telegraf_1 = require("telegraf");
const channels_1 = require("../services/channels");
const ui_1 = require("./ui");
const trunc = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
/** Text + keyboard shown to a user who has not joined every required channel. */
function buildGate(missing) {
    const text = [
        '🔒 <b>Join required</b>',
        '',
        'To use this bot you must join the channel(s) below first:',
        ...missing.map((c) => `• ${(0, ui_1.esc)(c.title)}${c.username ? ` (@${(0, ui_1.esc)(c.username)})` : ''}`),
        '',
        'After joining, tap <b>✅ I\'ve Joined</b>.',
    ].join('\n');
    const rows = missing.flatMap((c) => {
        const url = (0, channels_1.joinUrl)(c);
        return url ? [[telegraf_1.Markup.button.url(`📢 Join ${trunc(c.title, 40)}`, url)]] : [];
    });
    rows.push([telegraf_1.Markup.button.callback("✅ I've Joined", 'fs:check')]);
    return { text, keyboard: telegraf_1.Markup.inlineKeyboard(rows) };
}
//# sourceMappingURL=channelGate.js.map