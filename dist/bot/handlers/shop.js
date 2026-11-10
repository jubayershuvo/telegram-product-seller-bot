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
const logo_1 = require("./logo");
const inventory_1 = require("../../services/inventory");
const catalog_1 = require("../../services/catalog");
const purchase_1 = require("../../services/purchase");
const dataFile_1 = require("../../services/dataFile");
const Product_1 = require("../../models/Product");
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
        `${(0, ui_1.shopLogo)() || 'ℹ️'} <b>How ${(0, ui_1.shopName)()} works</b>`,
        ui_1.LINE,
        '1️⃣ ➕ <b>Recharge</b> your wallet (bKash / Nagad)',
        '2️⃣ 🛍 <b>Shop</b> — pick a product and a quantity',
        '3️⃣ ✅ <b>Confirm</b> — your file arrives instantly (Excel / CSV)',
        '',
        '📦 Every purchase is saved in <b>My Orders</b>, where you can download the file again at any time.',
        '',
        '<b>Commands</b>',
        '/shop  /balance  /recharge  /orders  /transactions  /deposits  /cancel',
        s.support ? `\n💬 Need help? Contact ${(0, ui_1.esc)(s.support)}` : '',
    ].join('\n'), { ...ui_1.HTML, ...(0, ui_1.mainMenu)(ctx.isAdmin) });
}
async function showBalance(ctx) {
    await (0, ui_1.clearState)(ctx.dbUser._id);
    const u = await freshUser(ctx);
    await ctx.reply([`💰 <b>Your wallet</b>`, ui_1.LINE, `Balance: <b>${(0, money_1.fmt)(u.balance)}</b>`, `Total deposited: ${(0, money_1.fmt)(u.totalDeposited)}`, `Total spent: ${(0, money_1.fmt)(u.totalSpent)}`].join('\n'), {
        ...ui_1.HTML,
        ...telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('➕ Recharge', 'rc:start'), telegraf_1.Markup.button.callback('🛍 Shop', 'buy:start')]]),
    });
}
// ---------- buying: catalog -> product -> quantity -> confirm ----------
async function showBuy(ctx, page = 0) {
    await (0, ui_1.clearState)(ctx.dbUser._id);
    const [u, products, stockMap] = await Promise.all([
        freshUser(ctx),
        Product_1.Product.find({ active: true, columnCount: { $gt: 0 } }).sort({ name: 1 }).lean(),
        (0, catalog_1.getStockMap)(),
    ]);
    if (!products.length) {
        return (0, ui_1.editOrReply)(ctx, `<b>${(0, ui_1.shopTitle)()}</b>\n\n😔 No products are available right now. Please check back soon.`);
    }
    const pages = Math.max(1, Math.ceil(products.length / PAGE));
    const cur = Math.min(Math.max(0, page), pages - 1);
    const slice = products.slice(cur * PAGE, (cur + 1) * PAGE);
    // catalog text: name, description, price and stock of every product on this page
    const cards = slice.map((p) => {
        const left = stockMap.get(String(p._id))?.available ?? 0;
        return [
            `📦 <b>${(0, ui_1.esc)(p.name)}</b>`,
            p.description ? `<i>${(0, ui_1.esc)((0, ui_1.trunc)(p.description, 120))}</i>` : '',
            `💵 <b>${(0, money_1.fmt)(p.price)}</b> each  •  ${(0, ui_1.stockLabel)(left)}`,
        ]
            .filter(Boolean)
            .join('\n');
    });
    const rows = slice.map((p) => {
        const left = stockMap.get(String(p._id))?.available ?? 0;
        const label = left > 0 ? `📦 ${p.name} • ${(0, money_1.fmt)(p.price)}` : `⚪ ${p.name} • sold out`;
        return [telegraf_1.Markup.button.callback((0, ui_1.trunc)(label, 60), `buy:p:${p._id}`)];
    });
    const nav = [];
    if (cur > 0)
        nav.push(telegraf_1.Markup.button.callback('⬅️ Prev', `buy:l:${cur - 1}`));
    if (pages > 1)
        nav.push(telegraf_1.Markup.button.callback(`${cur + 1} / ${pages}`, 'noop'));
    if (cur + 1 < pages)
        nav.push(telegraf_1.Markup.button.callback('Next ➡️', `buy:l:${cur + 1}`));
    if (nav.length)
        rows.push(nav);
    rows.push([telegraf_1.Markup.button.callback('➕ Recharge', 'rc:start'), telegraf_1.Markup.button.callback('📦 My orders', 'orders:p:0')]);
    await (0, ui_1.editOrReply)(ctx, [`<b>${(0, ui_1.shopTitle)()}</b>`, `💰 Your balance: <b>${(0, money_1.fmt)(u.balance)}</b>`, ui_1.LINE, cards.join('\n\n'), '', 'Tap a product to see details 👇'].join('\n'), telegraf_1.Markup.inlineKeyboard(rows));
}
/** Quick-pick quantities that fit the product's min / max / stock. */
function quickQuantities(min, max) {
    const list = [1, 5, 10, 25, 50, 100, 250, 500, 1000].filter((n) => n >= min && n <= max);
    if (!list.includes(min))
        list.unshift(min);
    return list.slice(0, 6);
}
async function showProduct(ctx, id) {
    const [p, u] = await Promise.all([(0, catalog_1.getProduct)(id), freshUser(ctx)]);
    if (!p || !p.active || p.columnCount < 1)
        return ctx.answerCbQuery('This product is no longer available.', { show_alert: true });
    const stock = await (0, catalog_1.getProductStock)(p._id);
    const range = (0, catalog_1.buyRange)(p, stock.available);
    if (stock.available < 1)
        return ctx.answerCbQuery('Sold out. Please check back later.', { show_alert: true });
    if (!range.buyable) {
        return ctx.answerCbQuery(`Only ${stock.available} left, below the minimum order of ${range.min}. Please check back later.`, { show_alert: true });
    }
    await ctx.answerCbQuery().catch(() => undefined);
    await (0, ui_1.setState)(ctx.dbUser._id, 'awaiting_quantity', { productId: String(p._id) });
    const qs = quickQuantities(range.min, range.max);
    const quick = qs.map((n) => telegraf_1.Markup.button.callback(`${n} • ${(0, money_1.fmt)((0, money_1.lineTotal)(p.price, n))}`, `buy:q:${p._id}:${n}`));
    if (range.max > range.min && !qs.includes(range.max)) {
        quick.push(telegraf_1.Markup.button.callback(`Max ${range.max} • ${(0, money_1.fmt)((0, money_1.lineTotal)(p.price, range.max))}`, `buy:q:${p._id}:${range.max}`));
    }
    const rows = [];
    for (let i = 0; i < quick.length; i += 3)
        rows.push(quick.slice(i, i + 3));
    rows.push([telegraf_1.Markup.button.callback('⬅️ All products', 'buy:start'), telegraf_1.Markup.button.callback('✖️ Cancel', 'buy:cancel')]);
    const limits = (0, catalog_1.describeLimits)(p);
    await (0, ui_1.editOrReply)(ctx, [
        `📦 <b>${(0, ui_1.esc)(p.name)}</b>`,
        p.description ? `<i>${(0, ui_1.esc)(p.description)}</i>` : '',
        ui_1.LINE,
        `💵 Price: <b>${(0, money_1.fmt)(p.price)}</b> each`,
        `📊 Stock: ${(0, ui_1.stockLabel)(stock.available)}`,
        limits ? `🔢 Per order: ${limits}` : '',
        `💰 Your balance: <b>${(0, money_1.fmt)(u.balance)}</b>`,
        '',
        range.min === range.max ? `👇 Tap the quantity below to continue.` : `✏️ <b>Tap a quantity</b> or send your own number (${range.min} – ${range.max}).`,
    ]
        .filter((l, i) => !(i === 1 && l === ''))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n'), telegraf_1.Markup.inlineKeyboard(rows));
}
async function showConfirm(ctx, productId, qty) {
    const [p, u] = await Promise.all([(0, catalog_1.getProduct)(productId), freshUser(ctx)]);
    if (!p || !p.active || p.columnCount < 1) {
        await (0, ui_1.clearState)(ctx.dbUser._id);
        return ctx.reply('😔 This product is no longer available. Open 🛍 Shop to pick another one.');
    }
    const stock = await (0, catalog_1.getProductStock)(p._id);
    const range = (0, catalog_1.buyRange)(p, stock.available);
    if (stock.available < 1) {
        await (0, ui_1.clearState)(ctx.dbUser._id);
        return ctx.reply('😔 Sorry, this product is sold out right now. Please check back later.');
    }
    if (!range.buyable) {
        await (0, ui_1.clearState)(ctx.dbUser._id);
        return ctx.reply(`😔 Only ${stock.available} left, which is below the minimum order of ${range.min}. Please check back later.`);
    }
    if (!Number.isSafeInteger(qty) || qty < range.min || qty > range.max) {
        return ctx.reply(`Please send a number between ${range.min} and ${range.max}.`);
    }
    const total = (0, money_1.lineTotal)(p.price, qty);
    const balance = (0, money_1.round2)(u.balance);
    await (0, ui_1.clearState)(ctx.dbUser._id);
    if (balance < total) {
        return (0, ui_1.editOrReply)(ctx, [
            '❌ <b>Insufficient balance</b>',
            ui_1.LINE,
            `${qty} × ${(0, ui_1.esc)(p.name)} = <b>${(0, money_1.fmt)(total)}</b>`,
            `Your balance: ${(0, money_1.fmt)(u.balance)}`,
            `You need <b>${(0, money_1.fmt)((0, money_1.round2)(total - balance))}</b> more.`,
        ].join('\n'), telegraf_1.Markup.inlineKeyboard([
            [telegraf_1.Markup.button.callback('➕ Recharge', 'rc:start')],
            [telegraf_1.Markup.button.callback('⬅️ Back to product', `buy:p:${p._id}`), telegraf_1.Markup.button.callback('🛍 Shop', 'buy:start')],
        ]));
    }
    await (0, ui_1.editOrReply)(ctx, [
        '🧾 <b>Order summary</b>',
        ui_1.LINE,
        `📦 Product: <b>${(0, ui_1.esc)(p.name)}</b>`,
        `🔢 Quantity: <b>${qty}</b>`,
        `💵 Price: ${(0, money_1.fmt)(p.price)} each`,
        ui_1.LINE,
        `💳 Total: <b>${(0, money_1.fmt)(total)}</b>`,
        `💰 Balance after: ${(0, money_1.fmt)((0, money_1.round2)(balance - total))}`,
    ].join('\n'), telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback('✅ Confirm purchase', `buy:ok:${p._id}:${qty}:${(0, money_1.round2)(p.price)}`)],
        [telegraf_1.Markup.button.callback('⬅️ Change quantity', `buy:p:${p._id}`), telegraf_1.Markup.button.callback('✖️ Cancel', 'buy:cancel')],
    ]));
}
async function handleQuantityInput(ctx, text) {
    const productId = String(ctx.dbUser.state?.data?.productId ?? '');
    if (!mongoose_1.Types.ObjectId.isValid(productId)) {
        await (0, ui_1.clearState)(ctx.dbUser._id);
        return ctx.reply('Please pick a product first 👇', (0, ui_1.mainMenu)(ctx.isAdmin));
    }
    const t = text.trim();
    if (!/^\d+$/.test(t) || t.length > 15)
        return ctx.reply('Please send a whole number, e.g. 25. (/cancel to stop)');
    return showConfirm(ctx, productId, parseInt(t, 10));
}
/** Tells the admins when a product just ran out or crossed the low-stock line (setting `lowStockAlert`, 0 = off). */
async function alertLowStock(ctx, productId, name, sold) {
    try {
        const { lowStockAlert } = await (0, settings_1.getSettings)();
        if (lowStockAlert <= 0)
            return;
        const left = (await (0, catalog_1.getProductStock)(productId)).available;
        if (left === 0) {
            await (0, notify_1.notifyAdmins)(ctx.telegram, `🔴 <b>${(0, ui_1.esc)(name)}</b> is now <b>sold out</b>.\nUpload more stock in /products.`);
        }
        else if (left + sold > lowStockAlert && left <= lowStockAlert) {
            await (0, notify_1.notifyAdmins)(ctx.telegram, `⚠️ <b>Low stock:</b> ${(0, ui_1.esc)(name)} has only <b>${left}</b> left.`);
        }
    }
    catch (e) {
        logger_1.logger.warn({ err: (0, errors_1.safeError)(e) }, 'Low-stock alert failed');
    }
}
async function confirmPurchase(ctx, productId, qty, price) {
    await ctx.editMessageReplyMarkup(undefined).catch(() => undefined); // block double taps
    const wait = await ctx.reply('⏳ Processing your order…');
    try {
        const productObjectId = new mongoose_1.Types.ObjectId(productId);
        const { order, rows } = await (0, userLock_1.withUserLock)(ctx.dbUser._id, () => (0, purchase_1.purchaseProduct)(ctx.dbUser._id, ctx.from.id, productObjectId, qty, price));
        const buf = await (0, dataFile_1.buildDataFile)(order, rows);
        const u = await freshUser(ctx);
        await ctx.replyWithDocument({ source: buf, filename: (0, dataFile_1.deliveryFileName)(order.productName, (0, ui_1.shortId)(order._id), qty, order.format) }, {
            caption: [
                `✅ <b>Order #${(0, ui_1.shortId)(order._id)} completed</b>`,
                ui_1.LINE,
                `📦 ${(0, ui_1.esc)(order.productName)} × ${qty}`,
                `💳 Paid: ${(0, money_1.fmt)(order.total)}`,
                `💰 Balance: ${(0, money_1.fmt)(u.balance)}`,
                '',
                'Thank you for your purchase! 🙌',
            ].join('\n'),
            ...ui_1.HTML,
            ...telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('🛍 Shop more', 'buy:start'), telegraf_1.Markup.button.callback('📦 My orders', 'orders:p:0')]]),
        });
        await (0, notify_1.notifyAdmins)(ctx.telegram, `🛒 <b>Sale</b> • ${(0, ui_1.esc)(order.productName)} × ${qty} • ${(0, money_1.fmt)(order.total)}\n👤 ${(0, ui_1.esc)(ctx.from.first_name)}${ctx.from.username ? ` @${(0, ui_1.esc)(ctx.from.username)}` : ''} (<code>${ctx.from.id}</code>)`);
        await alertLowStock(ctx, productObjectId, order.productName, qty);
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
const ORDER_ICON = { completed: '✅', processing: '⏳', failed: '❌' };
const TX_LABEL = {
    deposit: '➕ Recharge',
    purchase: '🛍 Purchase',
    refund: '↩️ Refund',
    admin_credit: '🎁 Credit',
    admin_debit: '➖ Debit',
};
async function showOrders(ctx, page = 0) {
    await (0, ui_1.clearState)(ctx.dbUser._id);
    const filter = { userId: ctx.dbUser._id, status: 'completed' };
    const [orders, count] = await Promise.all([
        Order_1.Order.find(filter).sort({ createdAt: -1 }).skip(page * PAGE).limit(PAGE).lean(),
        Order_1.Order.countDocuments(filter),
    ]);
    if (count === 0) {
        return (0, ui_1.editOrReply)(ctx, '📦 <b>My orders</b>\n\nYou have no purchases yet.', telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('🛍 Browse products', 'buy:start')]]));
    }
    const rows = orders.map((o) => [
        telegraf_1.Markup.button.callback((0, ui_1.trunc)(`#${(0, ui_1.shortId)(o._id)} • ${o.productName} × ${o.quantity} • ${(0, money_1.fmt)(o.total)}`, 60), `order:v:${o._id}`),
    ]);
    const nav = [];
    if (page > 0)
        nav.push(telegraf_1.Markup.button.callback('⬅️ Prev', `orders:p:${page - 1}`));
    if ((page + 1) * PAGE < count)
        nav.push(telegraf_1.Markup.button.callback('Next ➡️', `orders:p:${page + 1}`));
    if (nav.length)
        rows.push(nav);
    await (0, ui_1.editOrReply)(ctx, `📦 <b>My orders</b> (${count})\n${ui_1.LINE}\nTap an order to see details or download its file again.`, telegraf_1.Markup.inlineKeyboard(rows));
}
async function showOrder(ctx, id) {
    const o = mongoose_1.Types.ObjectId.isValid(id) ? await Order_1.Order.findOne({ _id: id, userId: ctx.dbUser._id }).lean() : null;
    if (!o)
        return ctx.answerCbQuery('Order not found', { show_alert: true });
    await (0, ui_1.editOrReply)(ctx, [
        `📦 <b>Order #${(0, ui_1.shortId)(o._id)}</b> ${ORDER_ICON[o.status]}`,
        ui_1.LINE,
        `Product: <b>${(0, ui_1.esc)(o.productName)}</b>`,
        `Quantity: ${o.quantity}`,
        `Unit price: ${(0, money_1.fmt)(o.unitPrice)}`,
        `Total: <b>${(0, money_1.fmt)(o.total)}</b>`,
        `Date: ${(0, money_1.fmtDate)(o.createdAt)}`,
    ].join('\n'), telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback('📥 Download file again', `order:d:${o._id}`)],
        [telegraf_1.Markup.button.callback('⬅️ My orders', 'orders:p:0')],
    ]));
}
async function downloadOrder(ctx, id) {
    const o = mongoose_1.Types.ObjectId.isValid(id) ? await Order_1.Order.findOne({ _id: id, userId: ctx.dbUser._id, status: 'completed' }).lean() : null;
    if (!o)
        return ctx.answerCbQuery('Order not found', { show_alert: true });
    const rows = await (0, inventory_1.getOrderRows)(o._id, ctx.dbUser._id);
    const buf = await (0, dataFile_1.buildDataFile)(o, rows); // uses the structure saved on the order, not the product's current one
    await ctx.replyWithDocument({ source: buf, filename: (0, dataFile_1.deliveryFileName)(o.productName, (0, ui_1.shortId)(o._id), o.quantity, o.format) }, { caption: `📦 Order #${(0, ui_1.shortId)(o._id)} • ${(0, ui_1.esc)(o.productName)} × ${o.quantity}`, ...ui_1.HTML });
}
async function showTransactions(ctx, page = 0) {
    await (0, ui_1.clearState)(ctx.dbUser._id);
    const filter = { userId: ctx.dbUser._id };
    const [txs, count] = await Promise.all([
        Transaction_1.Transaction.find(filter).sort({ createdAt: -1 }).skip(page * 10).limit(10).lean(),
        Transaction_1.Transaction.countDocuments(filter),
    ]);
    if (count === 0)
        return (0, ui_1.editOrReply)(ctx, '🧾 <b>Transactions</b>\n\nNo transactions yet.');
    const lines = txs.map((t) => `${TX_LABEL[t.type] ?? t.type} • <b>${(0, money_1.fmtSigned)(t.amount)}</b>\n<i>${(0, money_1.fmtDate)(t.createdAt)} • balance ${(0, money_1.fmt)(t.balanceAfter)}</i>${t.note ? `\n${(0, ui_1.esc)((0, ui_1.trunc)(t.note, 80))}` : ''}`);
    const nav = [];
    if (page > 0)
        nav.push(telegraf_1.Markup.button.callback('⬅️ Prev', `tx:p:${page - 1}`));
    if ((page + 1) * 10 < count)
        nav.push(telegraf_1.Markup.button.callback('Next ➡️', `tx:p:${page + 1}`));
    await (0, ui_1.editOrReply)(ctx, `🧾 <b>Transactions</b> (${count})\n${ui_1.LINE}\n${lines.join('\n\n')}`, nav.length ? telegraf_1.Markup.inlineKeyboard([nav]) : {});
}
async function showDeposits(ctx) {
    await (0, ui_1.clearState)(ctx.dbUser._id);
    const deps = await Deposit_1.Deposit.find({ userId: ctx.dbUser._id }).sort({ createdAt: -1 }).limit(10).lean();
    if (!deps.length)
        return ctx.reply('📥 No recharge requests yet.');
    const icon = { verified: '✅', failed: '❌', processing: '⏳' };
    const lines = deps.map((d) => `${icon[d.status]} ${d.method.toUpperCase()} • <code>${(0, ui_1.esc)(d.trxId)}</code> • ${(0, money_1.fmt)(d.verifiedAmount ?? d.claimedAmount)}\n${(0, money_1.fmtDate)(d.createdAt)}`);
    await ctx.reply(`📥 <b>Recharge history</b>\n${ui_1.LINE}\n${lines.join('\n\n')}`, ui_1.HTML);
}
/** Welcome screen (/start, and right after a user passes the channel check). */
async function showWelcome(ctx) {
    await (0, ui_1.clearState)(ctx.dbUser._id);
    // only what customers can actually buy: visible, ready products
    const [visible, stockMap, u] = await Promise.all([Product_1.Product.find({ active: true, columnCount: { $gt: 0 } }).select('_id').lean(), (0, catalog_1.getStockMap)(), freshUser(ctx)]);
    const products = visible.length;
    const inStock = visible.reduce((n, p) => n + (stockMap.get(String(p._id))?.available ?? 0), 0);
    await (0, logo_1.replyWithLogo)(ctx, [
        `<b>${(0, ui_1.shopTitle)()}</b>`,
        ui_1.LINE,
        `👋 Welcome, <b>${(0, ui_1.esc)(ctx.from?.first_name)}</b>!`,
        '',
        `💰 Wallet: <b>${(0, money_1.fmt)(u.balance)}</b>`,
        `🗂 Products: <b>${products}</b>   📦 In stock: <b>${inStock}</b>`,
        '',
        '<b>How it works</b>',
        '1️⃣ ➕ Recharge your wallet',
        '2️⃣ 🛍 Pick a product and quantity',
        '3️⃣ 📥 Get your file instantly',
        '',
        'Use the menu below 👇',
    ].join('\n'), (0, ui_1.mainMenu)(ctx.isAdmin));
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
    bot.command(['shop', 'buy', 'browse'], (ctx) => showBuy(ctx, 0));
    bot.hears([ui_1.BTN.buy, '🛒 Buy', '🛒 Buy Emails'], (ctx) => showBuy(ctx, 0)); // old keyboard labels still work
    bot.command('orders', (ctx) => showOrders(ctx, 0));
    bot.hears(ui_1.BTN.orders, (ctx) => showOrders(ctx, 0));
    bot.command('transactions', (ctx) => showTransactions(ctx, 0));
    bot.hears(ui_1.BTN.tx, (ctx) => showTransactions(ctx, 0));
    bot.command('deposits', showDeposits);
    bot.action('buy:start', async (ctx) => {
        await ctx.answerCbQuery();
        await showBuy(ctx, 0);
    });
    bot.action(/^buy:l:(\d+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        await showBuy(ctx, parseInt(ctx.match[1], 10));
    });
    bot.action(/^buy:p:([a-f0-9]{24})$/, async (ctx) => {
        await showProduct(ctx, ctx.match[1]); // answers the callback itself (alert when sold out)
    });
    // quick quantity button on the product page -> straight to the order summary
    bot.action(/^buy:q:([a-f0-9]{24}):(\d+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        await showConfirm(ctx, ctx.match[1], parseInt(ctx.match[2], 10));
    });
    bot.action('noop', (ctx) => ctx.answerCbQuery());
    // old preset / custom buttons still sitting in earlier chat messages simply open the custom-quantity prompt
    bot.action(/^buy:(custom|qty:\d+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        await showBuy(ctx, 0);
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
    bot.action(/^buy:ok:([a-f0-9]{24}):(\d+):(\d+(?:\.\d{1,2})?)$/, async (ctx) => {
        await ctx.answerCbQuery();
        await confirmPurchase(ctx, ctx.match[1], parseInt(ctx.match[2], 10), parseFloat(ctx.match[3]));
    });
    // confirm buttons from before the multi-product update carry no product id
    bot.action(/^buy:ok:\d+:/, async (ctx) => {
        await ctx.answerCbQuery('This button is outdated. Please pick the product again.', { show_alert: true });
        await showBuy(ctx, 0);
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