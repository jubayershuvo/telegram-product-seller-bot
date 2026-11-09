import { Markup, Telegraf } from 'telegraf';
import { Types } from 'mongoose';
import { BotContext } from '../context';
import { BTN, HTML, clearState, editOrReply, esc, mainMenu, setState, shortId } from '../ui';
import { getSettings } from '../../services/settings';
import { getStock, getOrderRows, maxBuyable } from '../../services/inventory';
import { getProduct, getProductStock, getStockMap } from '../../services/catalog';
import { purchaseProduct } from '../../services/purchase';
import { buildDataFile, deliveryFileName } from '../../services/dataFile';
import { Product } from '../../models/Product';
import { withUserLock } from '../../services/userLock';
import { Order } from '../../models/Order';
import { Transaction } from '../../models/Transaction';
import { Deposit } from '../../models/Deposit';
import { User } from '../../models/User';
import { AppError, safeError } from '../../utils/errors';
import { fmt, fmtDate, fmtSigned, lineTotal, round2 } from '../../utils/money';
import { logger } from '../../utils/logger';
import { notifyAdmins } from '../notify';

const PAGE = 8;

async function freshUser(ctx: BotContext) {
  return (await User.findById(ctx.dbUser._id)) ?? ctx.dbUser;
}

// ---------- basic screens ----------
async function showHelp(ctx: BotContext) {
  await clearState(ctx.dbUser._id);
  const s = await getSettings();
  await ctx.reply(
    [
      '<b>ℹ️ How it works</b>',
      '1. ➕ Recharge your wallet (bKash / Nagad)',
      '2. 🛒 Pick a product, then send how many you want',
      '3. Confirm — you instantly receive your file (Excel / CSV)',
      '',
      '<b>Commands</b>',
      '/balance /buy /recharge /orders /transactions /deposits /cancel',
      s.support ? `\nSupport: ${esc(s.support)}` : '',
    ].join('\n'),
    { ...HTML, ...mainMenu(ctx.isAdmin) },
  );
}

async function showBalance(ctx: BotContext) {
  await clearState(ctx.dbUser._id);
  const u = await freshUser(ctx);

  await ctx.reply(`💰 <b>Wallet balance:</b> ${fmt(u.balance)}\n📥 Total deposited: ${fmt(u.totalDeposited)}\n🛍 Total spent: ${fmt(u.totalSpent)}`, {
    ...HTML,
    ...Markup.inlineKeyboard([[Markup.button.callback('➕ Recharge', 'rc:start'), Markup.button.callback('🛒 Buy', 'buy:start')]]),
  });
}

// ---------- buying: product list -> quantity -> confirm ----------
const trunc = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** "✅ 120 in stock" / "⚠️ Only 3 left" / "❌ Sold out" */
export const stockLabel = (n: number): string => (n <= 0 ? '❌ Sold out' : n <= 10 ? `⚠️ Only ${n} left` : `✅ ${n} in stock`);

async function showBuy(ctx: BotContext, page = 0) {
  await clearState(ctx.dbUser._id);
  const [u, products, stockMap] = await Promise.all([
    freshUser(ctx),
    Product.find({ active: true, columnCount: { $gt: 0 } }).sort({ name: 1 }).lean(),
    getStockMap(),
  ]);
  if (!products.length) return editOrReply(ctx, '😔 No products are available right now. Please check back later.');

  const pages = Math.max(1, Math.ceil(products.length / PAGE));
  const cur = Math.min(Math.max(0, page), pages - 1);
  const slice = products.slice(cur * PAGE, (cur + 1) * PAGE);

  // catalog text: name, description, price and stock of every product
  const cards = slice.map((p) => {
    const left = stockMap.get(String(p._id))?.available ?? 0;
    return [
      `📦 <b>${esc(p.name)}</b>`,
      p.description ? `<i>${esc(trunc(p.description, 120))}</i>` : '',
      `💵 ${fmt(p.price)} each  •  ${stockLabel(left)}`,
    ]
      .filter(Boolean)
      .join('\n');
  });
  const rows = slice.map((p) => {
    const left = stockMap.get(String(p._id))?.available ?? 0;
    return [Markup.button.callback(trunc(left > 0 ? `🛒 ${p.name} • ${fmt(p.price)}` : `❌ ${p.name} • sold out`, 60), `buy:p:${p._id}`)];
  });
  const nav = [];
  if (cur > 0) nav.push(Markup.button.callback('⬅️ Prev', `buy:l:${cur - 1}`));
  if (cur + 1 < pages) nav.push(Markup.button.callback('Next ➡️', `buy:l:${cur + 1}`));
  if (nav.length) rows.push(nav);
  await editOrReply(
    ctx,
    `🛒 <b>Products</b>${pages > 1 ? ` (page ${cur + 1}/${pages})` : ''}\n💰 Your balance: <b>${fmt(u.balance)}</b>\n\n${cards.join('\n\n')}\n\nTap a product to buy 👇`,
    Markup.inlineKeyboard(rows),
  );
}

async function showProduct(ctx: BotContext, id: string) {
  const [s, p, u] = await Promise.all([getSettings(), getProduct(id), freshUser(ctx)]);
  if (!p || !p.active || p.columnCount < 1) return ctx.answerCbQuery('This product is no longer available.', { show_alert: true });
  const stock = await getProductStock(p._id);
  const max = maxBuyable(stock.available, s.maxQty);
  if (max < 1) return ctx.answerCbQuery('Sold out. Please check back later.', { show_alert: true });

  await ctx.answerCbQuery().catch(() => undefined);
  await setState(ctx.dbUser._id, 'awaiting_quantity', { productId: String(p._id) });
  await editOrReply(
    ctx,
    [
      `📦 <b>${esc(p.name)}</b>`,
      p.description ? `<i>${esc(p.description)}</i>` : '',
      '',
      `💵 Price: <b>${fmt(p.price)}</b> each`,
      `📊 Stock: <b>${stockLabel(stock.available)}</b>`,
      `💰 Your balance: <b>${fmt(u.balance)}</b>`,
      '',
      `✏️ Send the quantity you want (1 – ${max}).`,
      '/cancel to stop.',
    ]
      .filter((l, i) => !(i === 1 && l === ''))
      .join('\n'),
    Markup.inlineKeyboard([
      [Markup.button.callback('⬅️ All products', 'buy:start'), Markup.button.callback('✖️ Cancel', 'buy:cancel')],
    ]),
  );
}

export async function showConfirm(ctx: BotContext, productId: string, qty: number) {
  const [s, p, u] = await Promise.all([getSettings(), getProduct(productId), freshUser(ctx)]);
  if (!p || !p.active || p.columnCount < 1) {
    await clearState(ctx.dbUser._id);
    return ctx.reply('😔 This product is no longer available. Open 🛒 Buy to pick another one.');
  }
  const stock = await getProductStock(p._id);
  const max = maxBuyable(stock.available, s.maxQty);
  if (max < 1) {
    await clearState(ctx.dbUser._id);
    return ctx.reply('😔 Sorry, this product is sold out right now. Please check back later.');
  }
  if (!Number.isSafeInteger(qty) || qty < 1 || qty > max) return ctx.reply(`Please send a number between 1 and ${max}.`);
  const total = lineTotal(p.price, qty);
  const balance = round2(u.balance);
  await clearState(ctx.dbUser._id);

  if (balance < total) {
    return editOrReply(
      ctx,
      `❌ <b>Insufficient balance</b>\n\n${qty} × ${esc(p.name)} = <b>${fmt(total)}</b>\nYour balance: ${fmt(u.balance)}\nYou need <b>${fmt(round2(total - balance))}</b> more.`,
      Markup.inlineKeyboard([[Markup.button.callback('➕ Recharge', 'rc:start')]]),
    );
  }
  await editOrReply(
    ctx,
    `🧾 <b>Confirm purchase</b>\n\nProduct: <b>${esc(p.name)}</b>\nQuantity: <b>${qty}</b>\nPrice: ${fmt(p.price)} each\nTotal: <b>${fmt(total)}</b>\nBalance after: ${fmt(round2(balance - total))}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Confirm', `buy:ok:${p._id}:${qty}:${round2(p.price)}`), Markup.button.callback('✖️ Cancel', 'buy:cancel')],
    ]),
  );
}

export async function handleQuantityInput(ctx: BotContext, text: string) {
  const productId = String(ctx.dbUser.state?.data?.productId ?? '');
  if (!Types.ObjectId.isValid(productId)) {
    await clearState(ctx.dbUser._id);
    return ctx.reply('Please pick a product first 👇', mainMenu(ctx.isAdmin));
  }
  const t = text.trim();
  if (!/^\d+$/.test(t) || t.length > 15) return ctx.reply('Please send a whole number, e.g. 25. (/cancel to stop)');
  return showConfirm(ctx, productId, parseInt(t, 10));
}

async function confirmPurchase(ctx: BotContext, productId: string, qty: number, price: number) {
  await ctx.editMessageReplyMarkup(undefined).catch(() => undefined); // block double taps
  const wait = await ctx.reply('⏳ Processing your order…');
  try {
    const { order, rows } = await withUserLock(ctx.dbUser._id, () =>
      purchaseProduct(ctx.dbUser._id, ctx.from!.id, new Types.ObjectId(productId), qty, price),
    );
    const buf = await buildDataFile(order, rows);
    const u = await freshUser(ctx);
    await ctx.replyWithDocument(
      { source: buf, filename: deliveryFileName(order.productName, shortId(order._id), qty, order.format) },
      { caption: `✅ <b>Order #${shortId(order._id)} completed</b>\n${esc(order.productName)} × ${qty} • ${fmt(order.total)}\nBalance: ${fmt(u.balance)}`, ...HTML },
    );
    await notifyAdmins(ctx.telegram, `🛒 Sale: ${esc(order.productName)} × ${qty} • ${fmt(order.total)} • user <code>${ctx.from!.id}</code>`);
  } catch (err) {
    if (err instanceof AppError) await ctx.reply(err.message);
    else {
      logger.error({ err: safeError(err) }, 'Purchase failed');
      await ctx.reply('⚠️ Something went wrong. If you were charged, the amount is refunded automatically; check /orders and /transactions or contact support.');
    }
  } finally {
    await ctx.telegram.deleteMessage(wait.chat.id, wait.message_id).catch(() => undefined);
  }
}

// ---------- history ----------
async function showOrders(ctx: BotContext, page = 0) {
  await clearState(ctx.dbUser._id);
  const filter = { userId: ctx.dbUser._id, status: 'completed' };
  const [orders, count] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(page * PAGE).limit(PAGE).lean(),
    Order.countDocuments(filter),
  ]);
  if (count === 0) return editOrReply(ctx, '📦 You have no purchases yet.');
  const rows = orders.map((o) => [
    Markup.button.callback(trunc(`#${shortId(o._id)} • ${o.productName} × ${o.quantity} • ${fmt(o.total)}`, 60), `order:v:${o._id}`),
  ]);
  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('⬅️ Prev', `orders:p:${page - 1}`));
  if ((page + 1) * PAGE < count) nav.push(Markup.button.callback('Next ➡️', `orders:p:${page + 1}`));
  if (nav.length) rows.push(nav);
  await editOrReply(ctx, `📦 <b>My Orders</b> (${count}) — tap one for details`, Markup.inlineKeyboard(rows));
}

async function showOrder(ctx: BotContext, id: string) {
  const o = Types.ObjectId.isValid(id) ? await Order.findOne({ _id: id, userId: ctx.dbUser._id }).lean() : null;
  if (!o) return ctx.answerCbQuery('Order not found', { show_alert: true });
  await editOrReply(
    ctx,
    `📦 <b>Order #${shortId(o._id)}</b>\n\nProduct: ${esc(o.productName)}\nStatus: ${o.status}\nQuantity: ${o.quantity}\nUnit price: ${fmt(o.unitPrice)}\nTotal: ${fmt(o.total)}\nDate: ${fmtDate(o.createdAt)}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('📥 Download file again', `order:d:${o._id}`)],
      [Markup.button.callback('⬅️ Back', 'orders:p:0')],
    ]),
  );
}

async function downloadOrder(ctx: BotContext, id: string) {
  const o = Types.ObjectId.isValid(id) ? await Order.findOne({ _id: id, userId: ctx.dbUser._id, status: 'completed' }).lean() : null;
  if (!o) return ctx.answerCbQuery('Order not found', { show_alert: true });
  const rows = await getOrderRows(o._id, ctx.dbUser._id);
  const buf = await buildDataFile(o, rows); // uses the structure saved on the order, not the product's current one
  await ctx.replyWithDocument(
    { source: buf, filename: deliveryFileName(o.productName, shortId(o._id), o.quantity, o.format) },
    { caption: `Order #${shortId(o._id)} • ${esc(o.productName)}`, ...HTML },
  );
}

async function showTransactions(ctx: BotContext, page = 0) {
  await clearState(ctx.dbUser._id);
  const filter = { userId: ctx.dbUser._id };
  const [txs, count] = await Promise.all([
    Transaction.find(filter).sort({ createdAt: -1 }).skip(page * 10).limit(10).lean(),
    Transaction.countDocuments(filter),
  ]);
  if (count === 0) return editOrReply(ctx, '🧾 No transactions yet.');
  const lines = txs.map(
    (t) => `${fmtDate(t.createdAt)}\n<b>${fmtSigned(t.amount)}</b> • ${t.type} • bal ${fmt(t.balanceAfter)}${t.note ? `\n<i>${esc(t.note)}</i>` : ''}`,
  );
  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('⬅️ Prev', `tx:p:${page - 1}`));
  if ((page + 1) * 10 < count) nav.push(Markup.button.callback('Next ➡️', `tx:p:${page + 1}`));
  await editOrReply(ctx, `🧾 <b>Transactions</b> (${count})\n\n${lines.join('\n\n')}`, nav.length ? Markup.inlineKeyboard([nav]) : {});
}

async function showDeposits(ctx: BotContext) {
  await clearState(ctx.dbUser._id);
  const deps = await Deposit.find({ userId: ctx.dbUser._id }).sort({ createdAt: -1 }).limit(10).lean();
  if (!deps.length) return ctx.reply('📥 No recharge requests yet.');
  const icon = { verified: '✅', failed: '❌', processing: '⏳' } as const;
  const lines = deps.map(
    (d) => `${icon[d.status]} ${d.method.toUpperCase()} • <code>${esc(d.trxId)}</code> • ${fmt(d.verifiedAmount ?? d.claimedAmount)}\n${fmtDate(d.createdAt)}`,
  );
  await ctx.reply(`📥 <b>Recharge history</b>\n\n${lines.join('\n\n')}`, HTML);
}

/** Welcome screen (/start, and right after a user passes the channel check). */
export async function showWelcome(ctx: BotContext) {
  await clearState(ctx.dbUser._id);
  const [products, stock, u] = await Promise.all([Product.countDocuments({ active: true, columnCount: { $gt: 0 } }), getStock(), freshUser(ctx)]);
  await ctx.reply(
    [
      `👋 Welcome <b>${esc(ctx.from?.first_name)}</b>!`,
      '',
      `💰 Balance: <b>${fmt(u.balance)}</b>`,
      `🗂 Products: <b>${products}</b>`,
      `📦 In stock: <b>${stock.available}</b>`,
      '',
      '➕ Recharge → 🛒 Buy → pick a product and quantity → get your file instantly.',
      'Use the menu below 👇',
    ].join('\n'),
    { ...HTML, ...mainMenu(ctx.isAdmin) },
  );
}

export function registerShopHandlers(bot: Telegraf<BotContext>) {
  bot.start(showWelcome);
  bot.command('cancel', async (ctx) => {
    await clearState(ctx.dbUser._id);
    await ctx.reply('Cancelled.', mainMenu(ctx.isAdmin));
  });

  bot.command('help', showHelp);
  bot.hears(BTN.help, showHelp);
  bot.command('balance', showBalance);
  bot.hears(BTN.balance, showBalance);
  bot.command(['buy', 'browse', 'products'], (ctx) => showBuy(ctx, 0));
  bot.hears([BTN.buy, '🛒 Buy Emails'], (ctx) => showBuy(ctx, 0)); // old keyboard label still works
  bot.command('orders', (ctx) => showOrders(ctx, 0));
  bot.hears(BTN.orders, (ctx) => showOrders(ctx, 0));
  bot.command('transactions', (ctx) => showTransactions(ctx, 0));
  bot.hears(BTN.tx, (ctx) => showTransactions(ctx, 0));
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
  // old preset / custom buttons still sitting in earlier chat messages simply open the custom-quantity prompt
  bot.action(/^buy:(custom|qty:\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await showBuy(ctx, 0);
  });
  bot.action('x:cancel', async (ctx) => {
    await ctx.answerCbQuery('Cancelled');
    await clearState(ctx.dbUser._id);
    await ctx.editMessageText('Cancelled.').catch(() => undefined);
  });
  bot.action('buy:cancel', async (ctx) => {
    await ctx.answerCbQuery('Cancelled');
    await clearState(ctx.dbUser._id);
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
