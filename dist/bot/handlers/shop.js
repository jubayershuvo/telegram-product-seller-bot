"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.showConfirm = showConfirm;
exports.handleQuantityInput = handleQuantityInput;
exports.showWelcome = showWelcome;
exports.registerShopHandlers = registerShopHandlers;
const telegraf_1 = require("telegraf");
const mongoose_1 = require("mongoose");
const ui_1 = require("../ui");
const settings_1 = require("../../services/settings");
const inventory_1 = require("../../services/inventory");
const purchase_1 = require("../../services/purchase");
const excel_1 = require("../../services/excel");
const userLock_1 = require("../../services/userLock");
const Order_1 = require("../../models/Order");
const Transaction_1 = require("../../models/Transaction");
const Deposit_1 = require("../../models/Deposit");
const User_1 = require("../../models/User");
const errors_1 = require("../../utils/errors");
const money_1 = require("../../utils/money");
const logger_1 = require("../../utils/logger");
const notify_1 = require("../notify");
const PAGE = 8;
async function freshUser(ctx) {
    return (await User_1.User.findById(ctx.dbUser._id)) ?? ctx.dbUser;
}
// ---------- basic screens ----------
async function showHelp(ctx) {
    await (0, ui_1.clearState)(ctx.dbUser._id);
    const s = await (0, settings_1.getSettings)();
    await ctx.reply([
        '<b>ℹ️ How it works</b>',
        '1. ➕ Recharge your wallet (bKash / Nagad)',
        '2. 🛒 Choose how many emails you want',
        '3. Confirm — you instantly receive an Excel (.xlsx) file',
        '',
        '<b>Commands</b>',
        '/balance /buy /recharge /orders /transactions /deposits /cancel',
        s.support ? `\nSupport: ${(0, ui_1.esc)(s.support)}` : '',
    ].join('\n'), { ...ui_1.HTML, ...(0, ui_1.mainMenu)(ctx.isAdmin) });
}
async function showBalance(ctx) {
    await (0, ui_1.clearState)(ctx.dbUser._id);
    const u = await freshUser(ctx);
    await ctx.reply(`💰 <b>Wallet balance:</b> ${(0, money_1.fmt)(u.balance)}\n📥 Total deposited: ${(0, money_1.fmt)(u.totalDeposited)}\n🛍 Total spent: ${(0, money_1.fmt)(u.totalSpent)}`, {
        ...ui_1.HTML,
        ...telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('➕ Recharge', 'rc:start'), telegraf_1.Markup.button.callback('🛒 Buy', 'buy:start')]]),
    });
}
// ---------- buying (always custom quantity) ----------
async function showBuy(ctx) {
    await (0, ui_1.clearState)(ctx.dbUser._id);
    const [s, stock, u] = await Promise.all([(0, settings_1.getSettings)(), (0, inventory_1.getStock)(), freshUser(ctx)]);
    const max = (0, inventory_1.maxBuyable)(stock.available, s.maxQty);
    if (max < 1) {
        return (0, ui_1.editOrReply)(ctx, '😔 Sorry, emails are out of stock right now. Please check back later.');
    }
    await (0, ui_1.setState)(ctx.dbUser._id, 'awaiting_quantity');
    await (0, ui_1.editOrReply)(ctx, [
        '🛒 <b>Buy Emails</b>',
        '',
        `📦 In stock: <b>${stock.available}</b>`,
        `💵 Price: <b>${(0, money_1.fmt)(s.price)}</b> per email`,
        `💰 Your balance: <b>${(0, money_1.fmt)(u.balance)}</b>`,
        '',
        `✏️ Send the number of emails you want (1 – ${max}).`,
        '/cancel to stop.',
    ].join('\n'), telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('✖️ Cancel', 'buy:cancel')]]));
}
async function showConfirm(ctx, qty) {
    const [s, stock, u] = await Promise.all([(0, settings_1.getSettings)(), (0, inventory_1.getStock)(), freshUser(ctx)]);
    const max = (0, inventory_1.maxBuyable)(stock.available, s.maxQty);
    if (max < 1) {
        await (0, ui_1.clearState)(ctx.dbUser._id);
        return ctx.reply('😔 Sorry, emails are out of stock right now. Please check back later.');
    }
    if (!Number.isSafeInteger(qty) || qty < 1)
        return ctx.reply(`Please send a number between 1 and ${max}.`);
    if (qty > max)
        return ctx.reply(`Please send a number between 1 and ${max}.`);
    const total = (0, money_1.lineTotal)(s.price, qty);
    const balance = (0, money_1.round2)(u.balance);
    await (0, ui_1.clearState)(ctx.dbUser._id);
    if (balance < total) {
        return (0, ui_1.editOrReply)(ctx, `❌ <b>Insufficient balance</b>\n\n${qty} emails = <b>${(0, money_1.fmt)(total)}</b>\nYour balance: ${(0, money_1.fmt)(u.balance)}\nYou need <b>${(0, money_1.fmt)((0, money_1.round2)(total - balance))}</b> more.`, telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('➕ Recharge', 'rc:start')]]));
    }
    await (0, ui_1.editOrReply)(ctx, `🧾 <b>Confirm purchase</b>\n\nQuantity: <b>${qty}</b>\nPrice: ${(0, money_1.fmt)(s.price)} each\nTotal: <b>${(0, money_1.fmt)(total)}</b>\nBalance after: ${(0, money_1.fmt)((0, money_1.round2)(balance - total))}`, telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback('✅ Confirm', `buy:ok:${qty}:${(0, money_1.round2)(s.price)}`), telegraf_1.Markup.button.callback('✖️ Cancel', 'buy:cancel')],
    ]));
}
async function handleQuantityInput(ctx, text) {
    const t = text.trim();
    if (!/^\d+$/.test(t) || t.length > 15)
        return ctx.reply('Please send a whole number, e.g. 25. (/cancel to stop)');
    return showConfirm(ctx, parseInt(t, 10));
}
async function confirmPurchase(ctx, qty, price) {
    await ctx.editMessageReplyMarkup(undefined).catch(() => undefined); // block double taps
    const wait = await ctx.reply('⏳ Processing your order…');
    try {
        const { order, addresses } = await (0, userLock_1.withUserLock)(ctx.dbUser._id, () => (0, purchase_1.purchaseEmails)(ctx.dbUser._id, ctx.from.id, qty, price));
        const buf = await (0, excel_1.buildEmailWorkbook)(addresses);
        const u = await freshUser(ctx);
        await ctx.replyWithDocument({ source: buf, filename: `emails_${(0, ui_1.shortId)(order._id)}_${qty}.xlsx` }, { caption: `✅ <b>Order #${(0, ui_1.shortId)(order._id)} completed</b>\n${qty} emails • ${(0, money_1.fmt)(order.total)}\nBalance: ${(0, money_1.fmt)(u.balance)}`, ...ui_1.HTML });
        await (0, notify_1.notifyAdmins)(ctx.telegram, `🛒 Sale: ${qty} emails • ${(0, money_1.fmt)(order.total)} • user <code>${ctx.from.id}</code>`);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            await ctx.reply(err.message);
        else {
            logger_1.logger.error({ err: (0, errors_1.safeError)(err) }, 'Purchase failed');
            await ctx.reply('⚠️ Something went wrong. If you were charged, the amount is refunded automatically; check /orders and /transactions or contact support.');
        }
    }
    finally {
        await ctx.telegram.deleteMessage(wait.chat.id, wait.message_id).catch(() => undefined);
    }
}
// ---------- history ----------
async function showOrders(ctx, page = 0) {
    await (0, ui_1.clearState)(ctx.dbUser._id);
    const filter = { userId: ctx.dbUser._id, status: 'completed' };
    const [orders, count] = await Promise.all([
        Order_1.Order.find(filter).sort({ createdAt: -1 }).skip(page * PAGE).limit(PAGE).lean(),
        Order_1.Order.countDocuments(filter),
    ]);
    if (count === 0)
        return (0, ui_1.editOrReply)(ctx, '📦 You have no purchases yet.');
    const rows = orders.map((o) => [
        telegraf_1.Markup.button.callback(`#${(0, ui_1.shortId)(o._id)} • ${o.quantity} emails • ${(0, money_1.fmt)(o.total)}`, `order:v:${o._id}`),
    ]);
    const nav = [];
    if (page > 0)
        nav.push(telegraf_1.Markup.button.callback('⬅️ Prev', `orders:p:${page - 1}`));
    if ((page + 1) * PAGE < count)
        nav.push(telegraf_1.Markup.button.callback('Next ➡️', `orders:p:${page + 1}`));
    if (nav.length)
        rows.push(nav);
    await (0, ui_1.editOrReply)(ctx, `📦 <b>My Orders</b> (${count}) — tap one for details`, telegraf_1.Markup.inlineKeyboard(rows));
}
async function showOrder(ctx, id) {
    const o = mongoose_1.Types.ObjectId.isValid(id) ? await Order_1.Order.findOne({ _id: id, userId: ctx.dbUser._id }).lean() : null;
    if (!o)
        return ctx.answerCbQuery('Order not found', { show_alert: true });
    await (0, ui_1.editOrReply)(ctx, `📦 <b>Order #${(0, ui_1.shortId)(o._id)}</b>\n\nStatus: ${o.status}\nQuantity: ${o.quantity}\nUnit price: ${(0, money_1.fmt)(o.unitPrice)}\nTotal: ${(0, money_1.fmt)(o.total)}\nDate: ${(0, money_1.fmtDate)(o.createdAt)}`, telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback('📥 Download file again', `order:d:${o._id}`)],
        [telegraf_1.Markup.button.callback('⬅️ Back', 'orders:p:0')],
    ]));
}
async function downloadOrder(ctx, id) {
    const o = mongoose_1.Types.ObjectId.isValid(id) ? await Order_1.Order.findOne({ _id: id, userId: ctx.dbUser._id, status: 'completed' }).lean() : null;
    if (!o)
        return ctx.answerCbQuery('Order not found', { show_alert: true });
    const addresses = await (0, inventory_1.getOrderEmails)(o._id, ctx.dbUser._id);
    const buf = await (0, excel_1.buildEmailWorkbook)(addresses);
    await ctx.replyWithDocument({ source: buf, filename: `emails_${(0, ui_1.shortId)(o._id)}_${o.quantity}.xlsx` }, { caption: `Order #${(0, ui_1.shortId)(o._id)}` });
}
async function showTransactions(ctx, page = 0) {
    await (0, ui_1.clearState)(ctx.dbUser._id);
    const filter = { userId: ctx.dbUser._id };
    const [txs, count] = await Promise.all([
        Transaction_1.Transaction.find(filter).sort({ createdAt: -1 }).skip(page * 10).limit(10).lean(),
        Transaction_1.Transaction.countDocuments(filter),
    ]);
    if (count === 0)
        return (0, ui_1.editOrReply)(ctx, '🧾 No transactions yet.');
    const lines = txs.map((t) => `${(0, money_1.fmtDate)(t.createdAt)}\n<b>${(0, money_1.fmtSigned)(t.amount)}</b> • ${t.type} • bal ${(0, money_1.fmt)(t.balanceAfter)}${t.note ? `\n<i>${(0, ui_1.esc)(t.note)}</i>` : ''}`);
    const nav = [];
    if (page > 0)
        nav.push(telegraf_1.Markup.button.callback('⬅️ Prev', `tx:p:${page - 1}`));
    if ((page + 1) * 10 < count)
        nav.push(telegraf_1.Markup.button.callback('Next ➡️', `tx:p:${page + 1}`));
    await (0, ui_1.editOrReply)(ctx, `🧾 <b>Transactions</b> (${count})\n\n${lines.join('\n\n')}`, nav.length ? telegraf_1.Markup.inlineKeyboard([nav]) : {});
}
async function showDeposits(ctx) {
    await (0, ui_1.clearState)(ctx.dbUser._id);
    const deps = await Deposit_1.Deposit.find({ userId: ctx.dbUser._id }).sort({ createdAt: -1 }).limit(10).lean();
    if (!deps.length)
        return ctx.reply('📥 No recharge requests yet.');
    const icon = { verified: '✅', failed: '❌', processing: '⏳' };
    const lines = deps.map((d) => `${icon[d.status]} ${d.method.toUpperCase()} • <code>${(0, ui_1.esc)(d.trxId)}</code> • ${(0, money_1.fmt)(d.verifiedAmount ?? d.claimedAmount)}\n${(0, money_1.fmtDate)(d.createdAt)}`);
    await ctx.reply(`📥 <b>Recharge history</b>\n\n${lines.join('\n\n')}`, ui_1.HTML);
}
/** Welcome screen (/start, and right after a user passes the channel check). */
async function showWelcome(ctx) {
    await (0, ui_1.clearState)(ctx.dbUser._id);
    const [s, stock, u] = await Promise.all([(0, settings_1.getSettings)(), (0, inventory_1.getStock)(), freshUser(ctx)]);
    await ctx.reply([
        `👋 Welcome <b>${(0, ui_1.esc)(ctx.from?.first_name)}</b>!`,
        '',
        `💰 Balance: <b>${(0, money_1.fmt)(u.balance)}</b>`,
        `💵 Price: <b>${(0, money_1.fmt)(s.price)}</b> per email`,
        `📦 In stock: <b>${stock.available}</b>`,
        '',
        '➕ Recharge → 🛒 Buy Emails → get your Excel file instantly.',
        'Use the menu below 👇',
    ].join('\n'), { ...ui_1.HTML, ...(0, ui_1.mainMenu)(ctx.isAdmin) });
}
function registerShopHandlers(bot) {
    bot.start(showWelcome);
    bot.command('cancel', async (ctx) => {
        await (0, ui_1.clearState)(ctx.dbUser._id);
        await ctx.reply('Cancelled.', (0, ui_1.mainMenu)(ctx.isAdmin));
    });
    bot.command('help', showHelp);
    bot.hears(ui_1.BTN.help, showHelp);
    bot.command('balance', showBalance);
    bot.hears(ui_1.BTN.balance, showBalance);
    bot.command('buy', showBuy);
    bot.command('browse', showBuy);
    bot.hears(ui_1.BTN.buy, showBuy);
    bot.command('orders', (ctx) => showOrders(ctx, 0));
    bot.hears(ui_1.BTN.orders, (ctx) => showOrders(ctx, 0));
    bot.command('transactions', (ctx) => showTransactions(ctx, 0));
    bot.hears(ui_1.BTN.tx, (ctx) => showTransactions(ctx, 0));
    bot.command('deposits', showDeposits);
    bot.action('buy:start', async (ctx) => {
        await ctx.answerCbQuery();
        await showBuy(ctx);
    });
    // old preset / custom buttons still sitting in earlier chat messages simply open the custom-quantity prompt
    bot.action(/^buy:(custom|qty:\d+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        await showBuy(ctx);
    });
    bot.action('x:cancel', async (ctx) => {
        await ctx.answerCbQuery('Cancelled');
        await (0, ui_1.clearState)(ctx.dbUser._id);
        await ctx.editMessageText('Cancelled.').catch(() => undefined);
    });
    bot.action('buy:cancel', async (ctx) => {
        await ctx.answerCbQuery('Cancelled');
        await (0, ui_1.clearState)(ctx.dbUser._id);
        await ctx.editMessageText('Purchase cancelled.').catch(() => undefined);
    });
    bot.action(/^buy:ok:(\d+):(\d+(?:\.\d{1,2})?)$/, async (ctx) => {
        await ctx.answerCbQuery();
        await confirmPurchase(ctx, parseInt(ctx.match[1], 10), parseFloat(ctx.match[2]));
    });
    bot.action(/^orders:p:(\d+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        await showOrders(ctx, parseInt(ctx.match[1], 10));
    });
    bot.action(/^order:v:([a-f0-9]{24})$/, async (ctx) => {
        await ctx.answerCbQuery();
        await showOrder(ctx, ctx.match[1]);
    });
    bot.action(/^order:d:([a-f0-9]{24})$/, async (ctx) => {
        await ctx.answerCbQuery();
        await downloadOrder(ctx, ctx.match[1]);
    });
    bot.action(/^tx:p:(\d+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        await showTransactions(ctx, parseInt(ctx.match[1], 10));
    });
}
//# sourceMappingURL=shop.js.map