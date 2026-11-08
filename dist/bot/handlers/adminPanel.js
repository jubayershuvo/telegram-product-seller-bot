"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HELP = void 0;
exports.showPanel = showPanel;
exports.showUserPicker = showUserPicker;
exports.handleBalanceAmountInput = handleBalanceAmountInput;
exports.handleUserSearchInput = handleUserSearchInput;
exports.handleRechargeHoursInput = handleRechargeHoursInput;
exports.registerAdminPanel = registerAdminPanel;
const telegraf_1 = require("telegraf");
const mongoose_1 = require("mongoose");
const ui_1 = require("../ui");
const auth_1 = require("../middlewares/auth");
const env_1 = require("../../config/env");
const settings_1 = require("../../services/settings");
const rechargeGate_1 = require("../../services/rechargeGate");
const settingsParser_1 = require("../../services/settingsParser");
const Setting_1 = require("../../models/Setting");
const stats_1 = require("../../services/stats");
const wallet_1 = require("../../services/wallet");
const User_1 = require("../../models/User");
const Order_1 = require("../../models/Order");
const Deposit_1 = require("../../models/Deposit");
const Transaction_1 = require("../../models/Transaction");
const ImportBatch_1 = require("../../models/ImportBatch");
const money_1 = require("../../utils/money");
const cb = telegraf_1.Markup.button.callback;
const PAGE = 8;
const trunc = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const panelBack = [cb('⬅️ Admin panel', 'ap:home')];
exports.HELP = `<b>🛠 Admin commands</b>
Tip: /admin opens the button panel, no typing needed.

<b>Inventory</b>
Upload an <b>.xlsx</b> file (emails in Column A) to import
/stats – inventory, users, sales, deposits
/imports – recent imports

<b>Pricing &amp; settings</b>
/price – show price
/setprice &lt;amount&gt;
/settings_edit – edit settings step by step (pick category → pick setting → send value)
/settings – show all settings (saved in the database)
/set &lt;key&gt; &lt;value&gt; – change a setting (use <code>-</code> as value to clear text/list settings)
/resetsetting &lt;key&gt; – restore the default value
Keys: price, maxqty, rechargeenabled, rechargescheduleenabled, rechargeopentime, rechargeclosetime, bkash, nagad, minrecharge, maxrecharge, rechargepresets, currencysymbol, timezone, support, maxuploadmb, forcejoinenabled, trxidregex, maxfailedtrxperhour (see /settings)

<b>Channels &amp; broadcast</b>
/channels – required channels (add / remove with buttons; also in ⚙️ Settings)
/addchannel &lt;@username|id&gt; [invite link] – add a public or private channel
/removechannel &lt;@username|id&gt;
/forcejoin on|off – turn the channel check on or off
/broadcast – send text or media to all users (preview → confirm → live progress)

<b>Recharge control</b>
/recharge_on – open recharge for all users
/recharge_off – close recharge for all users
/recharge_hours 09:00 22:00 – open daily only in this window (<code>/recharge_hours off</code> removes the schedule)
/recharge_status – current state

<b>Users &amp; money</b>
/users [page]
/user &lt;id|@username&gt;
/addbalance – pick a user, choose credit/debit, enter amount
/addbalance &lt;id|@user&gt; &lt;amount&gt; [note]  (quick form)
/deductbalance &lt;id|@user&gt; &lt;amount&gt; [note]
/ban &lt;id|@user&gt;  /unban &lt;id|@user&gt;  /banned – list banned users

<b>History</b>
/allorders [page]
/alldeposits [page]
/alltx [page]`;
// =====================================================================
//  Admin panel (all buttons, no typing needed)
// =====================================================================
async function showPanel(ctx) {
    await (0, ui_1.clearState)(ctx.dbUser._id);
    const [st, s] = await Promise.all([(0, stats_1.getStats)(), (0, settings_1.getSettings)()]);
    await (0, ui_1.editOrReply)(ctx, [
        '🛠 <b>Admin panel</b>',
        '',
        `📦 In stock: <b>${st.stock.available}</b> / ${st.stock.total}   💵 Price: <b>${(0, money_1.fmt)(s.price)}</b>`,
        `👥 Users: <b>${st.users}</b>   🛍 Sold: <b>${st.sales.emails}</b> emails`,
        `💳 Recharge: ${(0, rechargeGate_1.describeRecharge)(s)}`,
        '',
        'Choose an action 👇',
    ].join('\n'), telegraf_1.Markup.inlineKeyboard([
        [cb(s.rechargeEnabled ? '🟢 Recharge ON — tap to turn OFF' : '🔴 Recharge OFF — tap to turn ON', 'rcx:t:p')],
        [cb('⏰ Recharge schedule', 'rcx:home')],
        [cb('🚫 Ban / Unban user', 'ab:search'), cb('📋 Banned list', 'bn:0')],
        [cb('💰 Add / Deduct balance', 'ab:p:0')],
        [cb('📊 Stats', 'ap:stats'), cb('👥 Users', 'ab:p:0')],
        [cb('🛍 Orders', 'ap:o:0'), cb('💳 Deposits', 'ap:d:0')],
        [cb('🧾 Transactions', 'ap:t:0'), cb('📥 Import emails', 'ap:imp')],
        [cb('📣 Broadcast', 'bc:start'), cb('📢 Channels', 'fc:home')],
        [cb('⚙️ Settings', 'se:home'), cb('📖 Commands', 'ap:help')],
    ]));
}
async function showStatsScreen(ctx) {
    const [s, st] = await Promise.all([(0, stats_1.getStats)(), (0, settings_1.getSettings)()]);
    await (0, ui_1.editOrReply)(ctx, [
        '📊 <b>Statistics</b>',
        '',
        `📧 Emails total: <b>${s.stock.total}</b>`,
        `🟢 Available: <b>${s.stock.available}</b>`,
        `🔴 Sold: <b>${s.stock.sold}</b>`,
        `💵 Price: <b>${(0, money_1.fmt)(st.price)}</b>`,
        '',
        `👥 Users: ${s.users} (banned: ${s.banned})`,
        `📥 Verified deposits: ${s.deposits.count} • ${(0, money_1.fmt)(s.deposits.sum)}`,
        `🛍 Orders: ${s.sales.orders} • ${s.sales.emails} emails • ${(0, money_1.fmt)(s.sales.revenue)}`,
    ].join('\n'), telegraf_1.Markup.inlineKeyboard([[cb('🔄 Refresh', 'ap:stats')], panelBack]));
}
function pager(prefix, page, count) {
    const nav = [];
    if (page > 0)
        nav.push(cb('⬅️ Prev', `${prefix}:${page - 1}`));
    if ((page + 1) * PAGE < count)
        nav.push(cb('Next ➡️', `${prefix}:${page + 1}`));
    return nav;
}
async function showOrdersScreen(ctx, page) {
    const [list, count] = await Promise.all([
        Order_1.Order.find().sort({ createdAt: -1 }).skip(page * PAGE).limit(PAGE).lean(),
        Order_1.Order.countDocuments(),
    ]);
    const lines = list.map((o) => `#${(0, ui_1.shortId)(o._id)} • <code>${o.telegramId}</code> • ${o.quantity} × ${(0, money_1.fmt)(o.unitPrice)} = <b>${(0, money_1.fmt)(o.total)}</b> • ${o.status}\n${(0, money_1.fmtDate)(o.createdAt)}`);
    const rows = [pager('ap:o', page, count), panelBack].filter((r) => r.length);
    await (0, ui_1.editOrReply)(ctx, `🛍 <b>Orders</b> (${count}) • page ${page + 1}\n\n${lines.join('\n\n') || '-'}`, telegraf_1.Markup.inlineKeyboard(rows));
}
async function showDepositsScreen(ctx, page) {
    const [list, count] = await Promise.all([
        Deposit_1.Deposit.find().sort({ createdAt: -1 }).skip(page * PAGE).limit(PAGE).lean(),
        Deposit_1.Deposit.countDocuments(),
    ]);
    const icon = { verified: '✅', failed: '❌', processing: '⏳' };
    const lines = list.map((d) => `${icon[d.status]} ${d.method} • <code>${d.telegramId}</code> • <code>${(0, ui_1.esc)(d.trxId)}</code> • ${(0, money_1.fmt)(d.verifiedAmount ?? d.claimedAmount)}${d.failReason ? `\n<i>${(0, ui_1.esc)(d.failReason.slice(0, 80))}</i>` : ''}\n${(0, money_1.fmtDate)(d.createdAt)}`);
    const rows = [pager('ap:d', page, count), panelBack].filter((r) => r.length);
    await (0, ui_1.editOrReply)(ctx, `💳 <b>Deposits</b> (${count}) • page ${page + 1}\n\n${lines.join('\n\n') || '-'}`, telegraf_1.Markup.inlineKeyboard(rows));
}
async function showTxScreen(ctx, page) {
    const [list, count] = await Promise.all([
        Transaction_1.Transaction.find().sort({ createdAt: -1 }).skip(page * PAGE).limit(PAGE).lean(),
        Transaction_1.Transaction.countDocuments(),
    ]);
    const lines = list.map((t) => `<code>${t.telegramId}</code> • ${t.type} • <b>${(0, money_1.fmtSigned)(t.amount)}</b> • bal ${(0, money_1.fmt)(t.balanceAfter)}\n${(0, money_1.fmtDate)(t.createdAt)}`);
    const rows = [pager('ap:t', page, count), panelBack].filter((r) => r.length);
    await (0, ui_1.editOrReply)(ctx, `🧾 <b>Transactions</b> (${count}) • page ${page + 1}\n\n${lines.join('\n\n') || '-'}`, telegraf_1.Markup.inlineKeyboard(rows));
}
async function showImportInfo(ctx) {
    const [s, list] = await Promise.all([(0, settings_1.getSettings)(), ImportBatch_1.ImportBatch.find().sort({ createdAt: -1 }).limit(5).lean()]);
    const recent = list.map((b) => `${(0, money_1.fmtDate)(b.createdAt)} • ${(0, ui_1.esc)(b.fileName)}\n+${b.inserted} new, ${b.duplicatesInDb} existing, ${b.duplicatesInFile} dup`);
    await (0, ui_1.editOrReply)(ctx, [
        '📥 <b>Import emails</b>',
        '',
        '1. Prepare an <b>.xlsx</b> file: emails in <b>Column A</b>, one per row',
        `2. Send it to this chat as a <b>file</b> (max ${s.maxUploadMb} MB)`,
        '3. The bot imports it and shows a report',
        '',
        recent.length ? `<b>Recent imports</b>\n${recent.join('\n\n')}` : 'No imports yet.',
    ].join('\n'), telegraf_1.Markup.inlineKeyboard([panelBack]));
}
// =====================================================================
//  Balance flow: pick user → Credit / Debit → amount → confirm
// =====================================================================
const who = (u) => `${u.firstName || 'User'}${u.username ? ` @${u.username}` : ''}`;
function userButtons(users) {
    return users.map((u) => [cb(trunc(`${u.isBanned ? '🚫 ' : ''}${who(u)} • ${(0, money_1.fmt)(u.balance)}`, 60), `ab:u:${u._id}`)]);
}
async function showUserPicker(ctx, page = 0) {
    await (0, ui_1.clearState)(ctx.dbUser._id);
    const [list, count] = await Promise.all([
        User_1.User.find().sort({ lastSeenAt: -1, createdAt: -1 }).skip(page * PAGE).limit(PAGE).lean(),
        User_1.User.countDocuments(),
    ]);
    const pages = Math.max(1, Math.ceil(count / PAGE));
    const rows = userButtons(list);
    const nav = pager('ab:p', page, count);
    if (nav.length)
        rows.push(nav);
    rows.push([cb('🔎 Search user', 'ab:search')]);
    rows.push(panelBack);
    await (0, ui_1.editOrReply)(ctx, `👥 <b>Select a user</b>\n${count} users • page ${page + 1}/${pages}\n\nTap a user to credit or debit their balance, or use search.`, telegraf_1.Markup.inlineKeyboard(rows));
}
async function showUserCard(ctx, id, notice) {
    const u = mongoose_1.Types.ObjectId.isValid(id) ? await User_1.User.findById(id).lean() : null;
    if (!u)
        return (0, ui_1.editOrReply)(ctx, 'User not found.', telegraf_1.Markup.inlineKeyboard([[cb('⬅️ Users', 'ab:p:0')]]));
    await (0, ui_1.clearState)(ctx.dbUser._id);
    const isAdminUser = env_1.env.ADMIN_IDS.includes(u.telegramId);
    const rows = [
        [cb('➕ Credit', `ab:c:${u._id}:c`), cb('➖ Debit', `ab:c:${u._id}:d`)],
    ];
    if (!isAdminUser)
        rows.push([cb(u.isBanned ? '✅ Unban user' : '🚫 Ban user', `ab:b:${u._id}`)]);
    else
        rows.push([cb('🛡 Admin — cannot be banned', 'ab:noop')]);
    rows.push([cb('⬅️ Users', 'ab:p:0'), cb('🛠 Panel', 'ap:home')]);
    await (0, ui_1.editOrReply)(ctx, [
        notice ?? '',
        `👤 ${(0, ui_1.userLabel)(u)}${u.isBanned ? ' 🚫 <b>BANNED</b>' : ''}`,
        '',
        `💰 Balance: <b>${(0, money_1.fmt)(u.balance)}</b>`,
        `📥 Deposited: ${(0, money_1.fmt)(u.totalDeposited)}`,
        `🛍 Spent: ${(0, money_1.fmt)(u.totalSpent)}`,
        `📅 Joined: ${(0, money_1.fmtDate)(u.createdAt)}`,
    ]
        .filter((l, i) => !(i === 0 && l === ''))
        .join('\n'), telegraf_1.Markup.inlineKeyboard(rows));
}
async function askAmount(ctx, id, sign) {
    const u = mongoose_1.Types.ObjectId.isValid(id) ? await User_1.User.findById(id).lean() : null;
    if (!u)
        return (0, ui_1.editOrReply)(ctx, 'User not found.', telegraf_1.Markup.inlineKeyboard([[cb('⬅️ Users', 'ab:p:0')]]));
    const s = await (0, settings_1.getSettings)();
    await (0, ui_1.setState)(ctx.dbUser._id, 'awaiting_balance_amount', { userId: id, sign });
    const quick = s.rechargePresets.slice(0, 5).map((a) => cb((0, money_1.fmt)(a), `ab:q:${a}`));
    const rows = [];
    if (quick.length)
        rows.push(quick);
    rows.push([cb('⬅️ Back', `ab:u:${id}`)]);
    await (0, ui_1.editOrReply)(ctx, [
        `${sign === 'c' ? '➕ <b>Credit</b>' : '➖ <b>Debit</b>'} — ${(0, ui_1.esc)(who(u))}`,
        `Current balance: <b>${(0, money_1.fmt)(u.balance)}</b>`,
        '',
        '✏️ <b>Send the amount</b> as a message, or tap a quick amount.',
        '/cancel to stop.',
    ].join('\n'), telegraf_1.Markup.inlineKeyboard(rows));
}
async function confirmAmount(ctx, amount) {
    const st = ctx.dbUser.state;
    const id = String(st?.data?.userId ?? '');
    const sign = st?.data?.sign === 'd' ? 'd' : 'c';
    const u = mongoose_1.Types.ObjectId.isValid(id) ? await User_1.User.findById(id).lean() : null;
    if (!u || st?.name !== 'awaiting_balance_amount')
        return ctx.reply('Session expired. Open /admin again.');
    if (sign === 'd' && amount > u.balance) {
        return ctx.reply(`❌ User balance is only ${(0, money_1.fmt)(u.balance)}. Send a smaller amount.`);
    }
    const after = (0, money_1.round2)(sign === 'c' ? u.balance + amount : u.balance - amount);
    await (0, ui_1.clearState)(ctx.dbUser._id);
    await (0, ui_1.editOrReply)(ctx, [
        '🧾 <b>Confirm</b>',
        '',
        `${sign === 'c' ? '➕ Credit' : '➖ Debit'} <b>${(0, money_1.fmt)(amount)}</b>`,
        `User: ${(0, ui_1.esc)(who(u))} (<code>${u.telegramId}</code>)`,
        `Balance: ${(0, money_1.fmt)(u.balance)} → <b>${(0, money_1.fmt)(after)}</b>`,
    ].join('\n'), telegraf_1.Markup.inlineKeyboard([[cb('✅ Confirm', `ab:ok:${sign}:${amount}:${u._id}`), cb('✖️ Cancel', `ab:u:${u._id}`)]]));
}
async function applyBalance(ctx, sign, amount, id) {
    const u = mongoose_1.Types.ObjectId.isValid(id) ? await User_1.User.findById(id) : null;
    if (!u || !Number.isFinite(amount) || amount <= 0 || (0, money_1.round2)(amount) !== amount)
        return ctx.reply('Invalid request.');
    await ctx.editMessageReplyMarkup(undefined).catch(() => undefined); // block double taps
    const msg = ctx.callbackQuery && 'message' in ctx.callbackQuery ? ctx.callbackQuery.message : undefined;
    // deterministic key per confirm message => a double tap can never apply the change twice
    const opKey = `admin:${msg?.chat.id ?? 0}:${msg?.message_id ?? Date.now()}`;
    const op = {
        userId: u._id,
        amount,
        opKey,
        type: sign === 'c' ? 'admin_credit' : 'admin_debit',
        note: `admin ${ctx.from.id}`,
    };
    const r = sign === 'c' ? await (0, wallet_1.creditWallet)(op) : await (0, wallet_1.debitWallet)(op);
    if (!r.ok) {
        const text = r.reason === 'insufficient' ? '❌ User balance is lower than that amount.' : r.reason === 'duplicate' ? 'ℹ️ This change was already applied.' : '❌ Failed.';
        return showUserCard(ctx, id, text);
    }
    await ctx.telegram
        .sendMessage(u.telegramId, `💰 Your wallet was ${sign === 'c' ? 'credited' : 'debited'} ${(0, money_1.fmt)(amount)} by admin.\nNew balance: ${(0, money_1.fmt)(r.balanceAfter ?? 0)}`)
        .catch(() => undefined);
    await ctx.reply(`✅ ${sign === 'c' ? 'Credited' : 'Debited'} <b>${(0, money_1.fmt)(amount)}</b> — new balance <b>${(0, money_1.fmt)(r.balanceAfter ?? 0)}</b>`, ui_1.HTML);
    await ctx.reply('What next?', telegraf_1.Markup.inlineKeyboard([[cb('👤 Back to user', `ab:u:${id}`), cb('👥 Users', 'ab:p:0')]]));
}
/** Text router: admin typed the amount. */
async function handleBalanceAmountInput(ctx, text) {
    if (!ctx.isAdmin)
        return ctx.reply('⛔ Admin only.');
    const amount = (0, money_1.parseAmount)(text);
    if (!amount)
        return ctx.reply('Please send a valid amount, e.g. 100 or 10.50 (/cancel to stop)');
    return confirmAmount(ctx, amount);
}
/** Text router: admin typed a search query. */
async function handleUserSearchInput(ctx, text) {
    if (!ctx.isAdmin)
        return ctx.reply('⛔ Admin only.');
    const q = text.trim().replace(/^@/, '');
    const esc2 = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = /^\d+$/.test(q)
        ? { telegramId: Number(q) }
        : { $or: [{ username: new RegExp(esc2, 'i') }, { firstName: new RegExp(esc2, 'i') }, { lastName: new RegExp(esc2, 'i') }] };
    const users = await User_1.User.find(filter).sort({ lastSeenAt: -1 }).limit(PAGE).lean();
    if (!users.length)
        return ctx.reply('No user found. Try another ID / @username / name, or /cancel.');
    if (users.length === 1)
        return showUserCard(ctx, String(users[0]._id));
    await (0, ui_1.clearState)(ctx.dbUser._id);
    const rows = userButtons(users);
    rows.push([cb('⬅️ Users', 'ab:p:0')]);
    await ctx.reply(`🔎 <b>${users.length} users found</b> — tap one:`, { ...ui_1.HTML, ...telegraf_1.Markup.inlineKeyboard(rows) });
}
// =====================================================================
//  Recharge control: on/off for everyone + daily schedule
// =====================================================================
async function showRechargeControl(ctx, notice) {
    await (0, ui_1.clearState)(ctx.dbUser._id);
    const s = await (0, settings_1.getSettings)();
    const st = await (0, rechargeGate_1.getRechargeStatus)();
    await (0, ui_1.editOrReply)(ctx, [
        notice ?? '',
        '💳 <b>Recharge control</b>',
        '',
        `Status now: ${st.open ? '🟢 <b>OPEN</b>' : '🔴 <b>CLOSED</b>'}`,
        `Master switch: <b>${s.rechargeEnabled ? 'ON' : 'OFF'}</b>  <i>(OFF closes recharge for all users immediately)</i>`,
        `Daily schedule: <b>${s.rechargeScheduleEnabled ? `ON — ${s.rechargeOpenTime} to ${s.rechargeCloseTime}` : 'OFF'}</b>  (${(0, ui_1.esc)(s.timezone)})`,
        '',
        'Recharge is open only when the master switch is ON <b>and</b> (if the schedule is ON) the time is inside the daily hours.',
    ]
        .filter((l, i) => !(i === 0 && l === ''))
        .join('\n'), telegraf_1.Markup.inlineKeyboard([
        [cb(s.rechargeEnabled ? '🔴 Turn recharge OFF' : '🟢 Turn recharge ON', 'rcx:t:c')],
        [cb(s.rechargeScheduleEnabled ? '⏰ Schedule: ON → turn OFF' : '⏰ Schedule: OFF → turn ON', 'rcx:s')],
        [cb('✏️ Set daily hours', 'rcx:h')],
        panelBack,
    ]));
}
/** Text router: admin typed daily hours like "09:00-22:00". */
async function handleRechargeHoursInput(ctx, text) {
    if (!ctx.isAdmin)
        return ctx.reply('⛔ Admin only.');
    const hours = parseHours(text);
    if (!hours)
        return ctx.reply('Send the hours as <code>09:00-22:00</code> (24h). /cancel to stop.', ui_1.HTML);
    await (0, rechargeGate_1.setRechargeHours)(hours[0], hours[1]);
    return showRechargeControl(ctx, `✅ Daily hours set: ${hours[0]} – ${hours[1]}`);
}
function parseHours(text) {
    const m = text.trim().match(/^(\d{1,2}:\d{2})\s*(?:-|–|to|\s)\s*(\d{1,2}:\d{2})$/i);
    if (!m)
        return null;
    const def = Setting_1.SETTING_DEFS.find((d) => d.key === 'rechargeOpenTime');
    const a = (0, settingsParser_1.parseSettingInput)(def, m[1]);
    const b = (0, settingsParser_1.parseSettingInput)(def, m[2]);
    if (!a.ok || !b.ok || a.value === b.value)
        return null;
    return [a.value, b.value];
}
// =====================================================================
//  Banned users list (unban in one tap)
// =====================================================================
async function showBannedScreen(ctx, page) {
    const filter = { isBanned: true };
    const [list, count] = await Promise.all([
        User_1.User.find(filter).sort({ updatedAt: -1 }).skip(page * PAGE).limit(PAGE).lean(),
        User_1.User.countDocuments(filter),
    ]);
    const rows = list.map((u) => [cb(trunc(`🚫 ${who(u)} • ${u.telegramId}`, 60), `ab:u:${u._id}`)]);
    const nav = pager('bn', page, count);
    if (nav.length)
        rows.push(nav);
    rows.push(panelBack);
    await (0, ui_1.editOrReply)(ctx, `🚫 <b>Banned users</b> (${count})\n\n${count ? 'Tap a user to unban or view.' : 'No banned users.'}`, telegraf_1.Markup.inlineKeyboard(rows));
}
async function notifyBanChange(ctx, telegramId, banned) {
    await ctx.telegram
        .sendMessage(telegramId, banned ? '🚫 Your account has been suspended.' : '✅ Your account has been restored. You can use the bot again.')
        .catch(() => undefined);
}
function registerAdminPanel(bot) {
    bot.hears(ui_1.BTN.admin, auth_1.adminOnly, showPanel);
    const act = (re, fn) => bot.action(re, auth_1.adminOnly, async (ctx) => {
        await ctx.answerCbQuery().catch(() => undefined);
        await fn(ctx);
    });
    act('ap:home', showPanel);
    act('ap:stats', showStatsScreen);
    act('ap:imp', showImportInfo);
    act('ap:help', (ctx) => (0, ui_1.editOrReply)(ctx, exports.HELP, telegraf_1.Markup.inlineKeyboard([panelBack])));
    act(/^ap:o:(\d+)$/, (ctx) => showOrdersScreen(ctx, parseInt(ctx.match[1], 10)));
    act(/^ap:d:(\d+)$/, (ctx) => showDepositsScreen(ctx, parseInt(ctx.match[1], 10)));
    act(/^ap:t:(\d+)$/, (ctx) => showTxScreen(ctx, parseInt(ctx.match[1], 10)));
    act(/^ab:p:(\d+)$/, (ctx) => showUserPicker(ctx, parseInt(ctx.match[1], 10)));
    act('ab:search', async (ctx) => {
        await (0, ui_1.setState)(ctx.dbUser._id, 'awaiting_user_search');
        await (0, ui_1.editOrReply)(ctx, '🔎 <b>Find user</b> (to ban / unban or edit balance)\n\nSend a Telegram ID, @username or name. The user card will have a 🚫 Ban / ✅ Unban button.\n/cancel to stop.', telegraf_1.Markup.inlineKeyboard([[cb('⬅️ Users', 'ab:p:0')]]));
    });
    act(/^ab:u:([a-f0-9]{24})$/, (ctx) => showUserCard(ctx, ctx.match[1]));
    act(/^ab:c:([a-f0-9]{24}):(c|d)$/, (ctx) => askAmount(ctx, ctx.match[1], ctx.match[2]));
    act(/^ab:q:(\d+(?:\.\d{1,2})?)$/, (ctx) => confirmAmount(ctx, parseFloat(ctx.match[1])));
    act(/^ab:ok:(c|d):(\d+(?:\.\d{1,2})?):([a-f0-9]{24})$/, (ctx) => applyBalance(ctx, ctx.match[1], parseFloat(ctx.match[2]), ctx.match[3]));
    act(/^ab:b:([a-f0-9]{24})$/, async (ctx) => {
        const u = await User_1.User.findById(ctx.match[1]);
        if (!u)
            return showUserPicker(ctx);
        if (env_1.env.ADMIN_IDS.includes(u.telegramId))
            return showUserCard(ctx, String(u._id), '⚠️ You cannot ban an admin.');
        await User_1.User.updateOne({ _id: u._id }, { isBanned: !u.isBanned });
        await notifyBanChange(ctx, u.telegramId, !u.isBanned);
        return showUserCard(ctx, String(u._id), u.isBanned ? '✅ User unbanned.' : '🚫 User banned.');
    });
    bot.action('ab:noop', auth_1.adminOnly, (ctx) => ctx.answerCbQuery('Admins cannot be banned. Test with a non-admin user.', { show_alert: true }));
    act(/^bn:(\d+)$/, (ctx) => showBannedScreen(ctx, parseInt(ctx.match[1], 10)));
    bot.command('banned', auth_1.adminOnly, (ctx) => showBannedScreen(ctx, 0));
    // ----- recharge control -----
    act('rcx:home', (ctx) => showRechargeControl(ctx));
    act(/^rcx:t:(p|c)$/, async (ctx) => {
        const on = !(await (0, settings_1.getSettings)()).rechargeEnabled;
        await (0, rechargeGate_1.setRechargeEnabled)(on);
        const notice = on ? '🟢 Recharge turned ON for all users.' : '🔴 Recharge turned OFF for all users.';
        return ctx.match[1] === 'p' ? showPanel(ctx) : showRechargeControl(ctx, notice);
    });
    act('rcx:s', async (ctx) => {
        const on = !(await (0, settings_1.getSettings)()).rechargeScheduleEnabled;
        await (0, rechargeGate_1.setRechargeScheduleEnabled)(on);
        return showRechargeControl(ctx, on ? '⏰ Daily schedule turned ON.' : '⏰ Daily schedule turned OFF (recharge follows the master switch only).');
    });
    act('rcx:h', async (ctx) => {
        await (0, ui_1.setState)(ctx.dbUser._id, 'awaiting_recharge_hours');
        await (0, ui_1.editOrReply)(ctx, '✏️ <b>Daily recharge hours</b>\n\nSend the opening and closing time, e.g. <code>09:00-22:00</code> (24h, shop timezone).\nAn overnight window such as <code>22:00-06:00</code> also works.\n/cancel to stop.', telegraf_1.Markup.inlineKeyboard([[cb('⬅️ Back', 'rcx:home')]]));
    });
    // ----- commands -----
    bot.command('recharge_on', auth_1.adminOnly, async (ctx) => {
        await (0, rechargeGate_1.setRechargeEnabled)(true);
        await ctx.reply('🟢 Recharge turned ON for all users.');
    });
    bot.command('recharge_off', auth_1.adminOnly, async (ctx) => {
        await (0, rechargeGate_1.setRechargeEnabled)(false);
        await ctx.reply('🔴 Recharge turned OFF for all users.');
    });
    // /recharge_hours 09:00 22:00   |   /recharge_hours off
    bot.command('recharge_hours', auth_1.adminOnly, async (ctx) => {
        const raw = (0, ui_1.commandArgs)(ctx).join(' ');
        if (/^off$/i.test(raw.trim())) {
            await (0, rechargeGate_1.setRechargeScheduleEnabled)(false);
            return ctx.reply('⏰ Daily schedule turned OFF.');
        }
        const hours = parseHours(raw);
        if (!hours)
            return ctx.reply('Usage: /recharge_hours 09:00 22:00   (or /recharge_hours off)');
        await (0, rechargeGate_1.setRechargeHours)(hours[0], hours[1]);
        return ctx.reply(`⏰ Recharge open daily ${hours[0]} – ${hours[1]}.`);
    });
    bot.command('recharge_status', auth_1.adminOnly, async (ctx) => ctx.reply(`💳 Recharge: ${(0, rechargeGate_1.describeRecharge)(await (0, settings_1.getSettings)())}`));
}
//# sourceMappingURL=adminPanel.js.map