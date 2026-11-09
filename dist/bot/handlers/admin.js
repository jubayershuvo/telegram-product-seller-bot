"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleSettingValueInput = handleSettingValueInput;
exports.registerAdminHandlers = registerAdminHandlers;
const telegraf_1 = require("telegraf");
const adminPanel_1 = require("./adminPanel");
const products_1 = require("./products");
const ui_1 = require("../ui");
const auth_1 = require("../middlewares/auth");
const env_1 = require("../../config/env");
const settings_1 = require("../../services/settings");
const settingsParser_1 = require("../../services/settingsParser");
const Setting_1 = require("../../models/Setting");
const stats_1 = require("../../services/stats");
const adminPanel_2 = require("./adminPanel");
const wallet_1 = require("../../services/wallet");
const User_1 = require("../../models/User");
const Order_1 = require("../../models/Order");
const Deposit_1 = require("../../models/Deposit");
const Transaction_1 = require("../../models/Transaction");
const ImportBatch_1 = require("../../models/ImportBatch");
const money_1 = require("../../utils/money");
const PAGE = 10;
const pageArg = (a) => Math.max(1, parseInt(a[0] ?? '1', 10) || 1);
const ALIASES = {
    bkash: 'bkashnumber',
    nagad: 'nagadnumber',
    currency: 'currencysymbol',
    presets: 'rechargepresets',
    maxupload: 'maxuploadmb',
    forcejoin: 'forcejoinenabled',
    trxregex: 'trxidregex',
};
function findDef(raw) {
    if (!raw)
        return undefined;
    const k = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    const name = ALIASES[k] ?? k;
    return Setting_1.SETTING_DEFS.find((d) => d.key.toLowerCase() === name);
}
function show(d, v) {
    if (d.secret)
        return v ? '••••••' : '-';
    let out;
    if (Array.isArray(v))
        out = v.join(', ');
    else if (d.key === 'price' || d.key === 'minRecharge' || d.key === 'maxRecharge')
        out = (0, money_1.fmt)(v);
    else if (d.key === 'maxQty')
        out = v === 0 ? '0 (no cap, limited by stock)' : String(v);
    else
        out = String(v ?? '');
    if (out === '')
        return '-';
    return out.length > 70 ? `${out.slice(0, 70)}…` : out;
}
async function findUser(q) {
    if (!q)
        return null;
    if (/^\d+$/.test(q))
        return User_1.User.findOne({ telegramId: Number(q) });
    return User_1.User.findOne({ username: new RegExp(`^${q.replace(/^@/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
}
// ---------- step-by-step settings editor ----------
const GROUPS = [...new Set(Setting_1.SETTING_DEFS.map((d) => d.group))];
const optionsOf = (d) => (d.type === 'bool' ? ['true', 'false'] : [...(d.options ?? [])]);
const trunc = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
async function showGroups(ctx) {
    await (0, ui_1.clearState)(ctx.dbUser._id);
    const rows = GROUPS.map((g, i) => [telegraf_1.Markup.button.callback(`📂 ${g}`, `se:g:${i}`)]);
    rows.push([telegraf_1.Markup.button.callback('📢 Required channels', 'fc:home')]);
    rows.push([telegraf_1.Markup.button.callback('✖️ Close', 'se:x')]);
    await (0, ui_1.editOrReply)(ctx, '⚙️ <b>Edit settings</b>\n\nChoose a category:', telegraf_1.Markup.inlineKeyboard(rows));
}
async function showGroup(ctx, gi) {
    const group = GROUPS[gi];
    if (!group)
        return showGroups(ctx);
    await (0, ui_1.clearState)(ctx.dbUser._id);
    const s = await (0, settings_1.getSettings)();
    const rows = Setting_1.SETTING_DEFS.map((d, i) => ({ d, i }))
        .filter(({ d }) => d.group === group)
        .map(({ d, i }) => [telegraf_1.Markup.button.callback(trunc(`${d.key}: ${show(d, s[d.key])}`, 60), `se:k:${i}`)]);
    rows.push([telegraf_1.Markup.button.callback('⬅️ Categories', 'se:home')]);
    await (0, ui_1.editOrReply)(ctx, `📂 <b>${(0, ui_1.esc)(group)}</b>\n\nTap a setting to change it:`, telegraf_1.Markup.inlineKeyboard(rows));
}
async function showKey(ctx, idx) {
    const d = Setting_1.SETTING_DEFS[idx];
    if (!d)
        return showGroups(ctx);
    const gi = GROUPS.indexOf(d.group);
    const s = await (0, settings_1.getSettings)();
    const opts = optionsOf(d);
    const lines = [
        `✏️ <b>${(0, ui_1.esc)(d.key)}</b>`,
        (0, ui_1.esc)(d.hint),
        '',
        `Current: <b>${(0, ui_1.esc)(show(d, s[d.key]))}</b>`,
        `Default: ${(0, ui_1.esc)(show(d, Setting_1.SETTING_DEFAULTS[d.key]))}`,
    ];
    const rows = [];
    if (opts.length) {
        lines.push('', 'Choose a value:');
        await (0, ui_1.clearState)(ctx.dbUser._id);
        const cur = String(s[d.key]);
        rows.push(opts.map((o, oi) => telegraf_1.Markup.button.callback(o === cur ? `✅ ${o}` : o, `se:v:${idx}:${oi}`)));
    }
    else {
        lines.push('', '👇 <b>Send the new value as a message.</b>', 'Use <code>-</code> to clear it. /cancel to stop.');
        await (0, ui_1.setState)(ctx.dbUser._id, 'awaiting_setting_value', { idx });
    }
    rows.push([telegraf_1.Markup.button.callback('♻️ Reset to default', `se:r:${idx}`)]);
    rows.push([telegraf_1.Markup.button.callback('⬅️ Back', `se:g:${gi}`)]);
    await (0, ui_1.editOrReply)(ctx, lines.join('\n'), telegraf_1.Markup.inlineKeyboard(rows));
}
async function applySetting(ctx, idx, raw) {
    const d = Setting_1.SETTING_DEFS[idx];
    if (!d)
        return false;
    const parsed = (0, settingsParser_1.parseSettingInput)(d, raw);
    if (!parsed.ok) {
        await ctx.reply(`❌ ${parsed.error}\n${d.key}: ${d.hint}\n\nTry again or /cancel.`);
        return false;
    }
    const problem = (0, settingsParser_1.crossCheck)(d.key, parsed.value, await (0, settings_1.getSettings)());
    if (problem) {
        await ctx.reply(`❌ ${problem}\n\nTry again or /cancel.`);
        return false;
    }
    await (0, settings_1.setSetting)(d.key, parsed.value);
    return true;
}
/** Called by the text router while the admin is in the "awaiting_setting_value" step. */
async function handleSettingValueInput(ctx, idx, text) {
    if (!ctx.isAdmin)
        return ctx.reply('⛔ Admin only.');
    const d = Setting_1.SETTING_DEFS[idx];
    if (d?.secret)
        await ctx.deleteMessage().catch(() => undefined);
    if (!(await applySetting(ctx, idx, text)))
        return;
    await (0, ui_1.clearState)(ctx.dbUser._id);
    const s = await (0, settings_1.getSettings)();
    await ctx.reply(`✅ <code>${d.key}</code> saved: <b>${(0, ui_1.esc)(show(d, s[d.key]))}</b>`, ui_1.HTML);
    await showGroup(ctx, GROUPS.indexOf(d.group));
}
function registerSettingsEditor(bot) {
    bot.command(['settings_edit', 'editsettings', 'settingsedit'], auth_1.adminOnly, showGroups);
    bot.action('se:home', auth_1.adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        await showGroups(ctx);
    });
    bot.action('se:x', auth_1.adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        await (0, ui_1.clearState)(ctx.dbUser._id);
        await ctx.editMessageText('Closed.').catch(() => undefined);
    });
    bot.action(/^se:g:(\d+)$/, auth_1.adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        await showGroup(ctx, parseInt(ctx.match[1], 10));
    });
    bot.action(/^se:k:(\d+)$/, auth_1.adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        await showKey(ctx, parseInt(ctx.match[1], 10));
    });
    bot.action(/^se:v:(\d+):(\d+)$/, auth_1.adminOnly, async (ctx) => {
        const idx = parseInt(ctx.match[1], 10);
        const d = Setting_1.SETTING_DEFS[idx];
        const value = d ? optionsOf(d)[parseInt(ctx.match[2], 10)] : undefined;
        if (!d || value === undefined)
            return ctx.answerCbQuery('Unknown option', { show_alert: true });
        if (!(await applySetting(ctx, idx, value)))
            return ctx.answerCbQuery();
        await ctx.answerCbQuery('Saved ✅');
        await showKey(ctx, idx);
    });
    bot.action(/^se:r:(\d+)$/, auth_1.adminOnly, async (ctx) => {
        const idx = parseInt(ctx.match[1], 10);
        const d = Setting_1.SETTING_DEFS[idx];
        if (!d)
            return ctx.answerCbQuery();
        await (0, settings_1.resetSetting)(d.key);
        await ctx.answerCbQuery('Reset to default ♻️');
        await showKey(ctx, idx);
    });
}
function registerAdminHandlers(bot) {
    bot.command('admin', auth_1.adminOnly, adminPanel_1.showPanel);
    (0, adminPanel_1.registerAdminPanel)(bot);
    (0, products_1.registerProductHandlers)(bot); // products, csv/xlsx upload
    registerSettingsEditor(bot);
    // ---------- stats / settings ----------
    bot.command('stats', auth_1.adminOnly, async (ctx) => {
        const [s, st] = await Promise.all([(0, stats_1.getStats)(), (0, settings_1.getSettings)()]);
        await ctx.reply((0, adminPanel_2.statsText)(s), ui_1.HTML);
    });
    bot.command('price', auth_1.adminOnly, async (ctx) => ctx.reply(`💵 Default price for new products: <b>${(0, money_1.fmt)((await (0, settings_1.getSettings)()).price)}</b>\nEach product has its own price: /products`, ui_1.HTML));
    bot.command('setprice', auth_1.adminOnly, async (ctx) => {
        const amt = (0, money_1.parseAmount)((0, ui_1.commandArgs)(ctx)[0] ?? '');
        if (!amt)
            return ctx.reply('Usage: /setprice <amount>   (default price for NEW products) e.g. /setprice 5.50');
        await (0, settings_1.setSetting)('price', amt);
        await ctx.reply(`✅ Default price for new products set to ${(0, money_1.fmt)(amt)}. (Change a product's own price in /products.)`);
    });
    bot.command('settings', auth_1.adminOnly, async (ctx) => {
        const s = await (0, settings_1.getSettings)();
        const lines = ['⚙️ <b>Settings</b> (stored in database)'];
        let group = '';
        for (const d of Setting_1.SETTING_DEFS) {
            if (d.group !== group) {
                group = d.group;
                lines.push('', `<b>${(0, ui_1.esc)(group)}</b>`);
            }
            lines.push(`<code>${d.key}</code>: ${(0, ui_1.esc)(show(d, s[d.key]))}`);
        }
        lines.push('', 'Change: /set &lt;key&gt; &lt;value&gt;  •  Default: /resetsetting &lt;key&gt;');
        await ctx.reply(lines.join('\n'), ui_1.HTML);
    });
    bot.command('set', auth_1.adminOnly, async (ctx) => {
        const [key, ...rest] = (0, ui_1.commandArgs)(ctx);
        const value = rest.join(' ').trim();
        if (!key || !value)
            return ctx.reply('Usage: /set <key> <value>   (see /settings for the keys)\nUse - as value to clear a text/list setting.');
        const def = findDef(key);
        if (!def)
            return ctx.reply('Unknown key. Send /settings to see all keys.');
        const parsed = (0, settingsParser_1.parseSettingInput)(def, value);
        // never leave secrets sitting in the chat history
        if (def.secret)
            await ctx.deleteMessage().catch(() => undefined);
        if (!parsed.ok)
            return ctx.reply(`❌ ${parsed.error}\n${def.key}: ${def.hint}`);
        const current = await (0, settings_1.getSettings)();
        const problem = (0, settingsParser_1.crossCheck)(def.key, parsed.value, current);
        if (problem)
            return ctx.reply(`❌ ${problem}`);
        await (0, settings_1.setSetting)(def.key, parsed.value);
        await ctx.reply(`✅ <code>${def.key}</code> saved: ${(0, ui_1.esc)(show(def, parsed.value))}`, ui_1.HTML);
    });
    bot.command('resetsetting', auth_1.adminOnly, async (ctx) => {
        const def = findDef((0, ui_1.commandArgs)(ctx)[0]);
        if (!def)
            return ctx.reply('Usage: /resetsetting <key>   (see /settings for the keys)');
        await (0, settings_1.resetSetting)(def.key);
        await ctx.reply(`♻️ <code>${def.key}</code> reset to default: ${(0, ui_1.esc)(show(def, Setting_1.SETTING_DEFAULTS[def.key]))}`, ui_1.HTML);
    });
    bot.command('imports', auth_1.adminOnly, async (ctx) => {
        const list = await ImportBatch_1.ImportBatch.find().sort({ createdAt: -1 }).limit(10).lean();
        if (!list.length)
            return ctx.reply('No imports yet.');
        await ctx.reply('📥 <b>Recent imports</b>\n\n' +
            list.map((b) => `${(0, money_1.fmtDate)(b.createdAt)} • ${(0, ui_1.esc)(b.fileName)}${b.productName ? ` → <b>${(0, ui_1.esc)(b.productName)}</b>` : ''}\n+${b.inserted} new, ${b.duplicatesInDb} existing, ${b.duplicatesInFile} dup`).join('\n\n'), ui_1.HTML);
    });
    // ---------- users ----------
    bot.command('users', auth_1.adminOnly, async (ctx) => {
        const page = pageArg((0, ui_1.commandArgs)(ctx));
        const [list, count] = await Promise.all([
            User_1.User.find().sort({ createdAt: -1 }).skip((page - 1) * PAGE).limit(PAGE).lean(),
            User_1.User.countDocuments(),
        ]);
        const lines = list.map((u) => `${(0, ui_1.userLabel)(u)}${u.isBanned ? ' 🚫' : ''}\nbal ${(0, money_1.fmt)(u.balance)} • spent ${(0, money_1.fmt)(u.totalSpent)} • dep ${(0, money_1.fmt)(u.totalDeposited)}`);
        await ctx.reply(`👥 <b>Users</b> ${count} • page ${page}/${Math.max(1, Math.ceil(count / PAGE))}\n\n${lines.join('\n\n') || '-'}`, ui_1.HTML);
    });
    bot.command('user', auth_1.adminOnly, async (ctx) => {
        const u = await findUser((0, ui_1.commandArgs)(ctx)[0]);
        if (!u)
            return ctx.reply('User not found. Usage: /user <id|@username>');
        const [orders, deps, ordersCount] = await Promise.all([
            Order_1.Order.find({ userId: u._id, status: 'completed' }).sort({ createdAt: -1 }).limit(5).lean(),
            Deposit_1.Deposit.find({ userId: u._id }).sort({ createdAt: -1 }).limit(5).lean(),
            Order_1.Order.countDocuments({ userId: u._id, status: 'completed' }),
        ]);
        await ctx.reply([
            `👤 ${(0, ui_1.userLabel)(u)}${u.isBanned ? ' 🚫 BANNED' : ''}`,
            `Joined: ${(0, money_1.fmtDate)(u.createdAt)}`,
            `Balance: <b>${(0, money_1.fmt)(u.balance)}</b> • Deposited: ${(0, money_1.fmt)(u.totalDeposited)} • Spent: ${(0, money_1.fmt)(u.totalSpent)}`,
            `Orders: ${ordersCount}`,
            '',
            '<b>Last orders</b>',
            ...(orders.map((o) => `#${(0, ui_1.shortId)(o._id)} • ${(0, ui_1.esc)(o.productName)} × ${o.quantity} • ${(0, money_1.fmt)(o.total)} • ${(0, money_1.fmtDate)(o.createdAt)}`) || []),
            '',
            '<b>Last deposits</b>',
            ...(deps.map((d) => `${d.status} • ${d.method} • <code>${(0, ui_1.esc)(d.trxId)}</code> • ${(0, money_1.fmt)(d.verifiedAmount ?? d.claimedAmount)}`) || []),
        ].join('\n'), ui_1.HTML);
    });
    const adjust = (sign) => async (ctx) => {
        const [who, amtRaw, ...note] = (0, ui_1.commandArgs)(ctx);
        if (!who)
            return (0, adminPanel_1.showUserPicker)(ctx); // no arguments: guided flow (pick user → credit/debit → amount)
        const amt = (0, money_1.parseAmount)(amtRaw ?? '');
        const u = await findUser(who);
        if (!u || !amt)
            return ctx.reply(`Usage: /${sign === 1 ? 'addbalance' : 'deductbalance'} <id|@user> <amount> [note]`);
        const op = {
            userId: u._id,
            amount: amt,
            opKey: (0, wallet_1.newOpKey)('admin'),
            type: sign === 1 ? 'admin_credit' : 'admin_debit',
            note: `admin ${ctx.from.id}${note.length ? `: ${note.join(' ')}` : ''}`,
        };
        const r = sign === 1 ? await (0, wallet_1.creditWallet)(op) : await (0, wallet_1.debitWallet)(op);
        if (!r.ok)
            return ctx.reply(r.reason === 'insufficient' ? '❌ User balance is lower than that amount.' : '❌ Failed.');
        await ctx.reply(`✅ Done. ${(0, ui_1.userLabel)(u)} new balance: <b>${(0, money_1.fmt)(r.balanceAfter ?? 0)}</b>`, ui_1.HTML);
        await ctx.telegram
            .sendMessage(u.telegramId, `💰 Your wallet was ${sign === 1 ? 'credited' : 'debited'} ${(0, money_1.fmt)(amt)} by admin.\nNew balance: ${(0, money_1.fmt)(r.balanceAfter ?? 0)}`)
            .catch(() => undefined);
    };
    bot.command('addbalance', auth_1.adminOnly, adjust(1));
    bot.command('deductbalance', auth_1.adminOnly, adjust(-1));
    const ban = (value) => async (ctx) => {
        const u = await findUser((0, ui_1.commandArgs)(ctx)[0]);
        if (!u)
            return ctx.reply('User not found.');
        if (env_1.env.ADMIN_IDS.includes(u.telegramId))
            return ctx.reply('You cannot ban an admin.');
        await User_1.User.updateOne({ _id: u._id }, { isBanned: value });
        await ctx.telegram
            .sendMessage(u.telegramId, value ? '🚫 Your account has been suspended.' : '✅ Your account has been restored. You can use the bot again.')
            .catch(() => undefined);
        await ctx.reply(`${value ? '🚫 Banned' : '✅ Unbanned'}: ${(0, ui_1.userLabel)(u)}`, ui_1.HTML);
    };
    bot.command('ban', auth_1.adminOnly, ban(true));
    bot.command('unban', auth_1.adminOnly, ban(false));
    // ---------- global history ----------
    bot.command('allorders', auth_1.adminOnly, async (ctx) => {
        const page = pageArg((0, ui_1.commandArgs)(ctx));
        const [list, count] = await Promise.all([
            Order_1.Order.find().sort({ createdAt: -1 }).skip((page - 1) * PAGE).limit(PAGE).lean(),
            Order_1.Order.countDocuments(),
        ]);
        const lines = list.map((o) => `#${(0, ui_1.shortId)(o._id)} • <code>${o.telegramId}</code> • ${(0, ui_1.esc)(o.productName)} • ${o.quantity} × ${(0, money_1.fmt)(o.unitPrice)} = <b>${(0, money_1.fmt)(o.total)}</b> • ${o.status}\n${(0, money_1.fmtDate)(o.createdAt)}`);
        await ctx.reply(`🛍 <b>Orders</b> ${count} • page ${page}\n\n${lines.join('\n\n') || '-'}`, ui_1.HTML);
    });
    bot.command('alldeposits', auth_1.adminOnly, async (ctx) => {
        const page = pageArg((0, ui_1.commandArgs)(ctx));
        const [list, count] = await Promise.all([
            Deposit_1.Deposit.find().sort({ createdAt: -1 }).skip((page - 1) * PAGE).limit(PAGE).lean(),
            Deposit_1.Deposit.countDocuments(),
        ]);
        const lines = list.map((d) => `${d.status} • ${d.method} • <code>${d.telegramId}</code> • <code>${(0, ui_1.esc)(d.trxId)}</code> • ${(0, money_1.fmt)(d.verifiedAmount ?? d.claimedAmount)}${d.failReason ? `\n<i>${(0, ui_1.esc)(d.failReason.slice(0, 80))}</i>` : ''}\n${(0, money_1.fmtDate)(d.createdAt)}`);
        await ctx.reply(`📥 <b>Deposits</b> ${count} • page ${page}\n\n${lines.join('\n\n') || '-'}`, ui_1.HTML);
    });
    bot.command('alltx', auth_1.adminOnly, async (ctx) => {
        const page = pageArg((0, ui_1.commandArgs)(ctx));
        const [list, count] = await Promise.all([
            Transaction_1.Transaction.find().sort({ createdAt: -1 }).skip((page - 1) * PAGE).limit(PAGE).lean(),
            Transaction_1.Transaction.countDocuments(),
        ]);
        const lines = list.map((t) => `<code>${t.telegramId}</code> • ${t.type} • <b>${(0, money_1.fmtSigned)(t.amount)}</b> • bal ${(0, money_1.fmt)(t.balanceAfter)}\n${(0, money_1.fmtDate)(t.createdAt)}`);
        await ctx.reply(`🧾 <b>Transactions</b> ${count} • page ${page}\n\n${lines.join('\n\n') || '-'}`, ui_1.HTML);
    });
}
//# sourceMappingURL=admin.js.map