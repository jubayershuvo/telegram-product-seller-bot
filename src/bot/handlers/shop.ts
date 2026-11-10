import { Markup, Telegraf } from 'telegraf';
import { Types } from 'mongoose';
import { BotContext } from '../context';
import { BTN, HTML, LINE, clearState, editOrReply, esc, mainMenu, setState, shopName, shopTitle, shopLogo, shortId, stockLabel, trunc } from '../ui';
import { getSettings } from '../../services/settings';
import { replyWithLogo } from './logo';
import { getOrderRows } from '../../services/inventory';
import { buyRange, describeLimits, getProduct, getProductStock, getStockMap } from '../../services/catalog';
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
      `${shopLogo() || 'ℹ️'} <b>How ${shopName()} works</b>`,
      LINE,
      '1️⃣ ➕ <b>Recharge</b> your wallet (bKash / Nagad)',
      '2️⃣ 🛍 <b>Shop</b> — pick a product and a quantity',
      '3️⃣ ✅ <b>Confirm</b> — your file arrives instantly (Excel / CSV)',
      '',
      '📦 Every purchase is saved in <b>My Orders</b>, where you can download the file again at any time.',
      '',
      '<b>Commands</b>',
      '/shop  /balance  /recharge  /orders  /transactions  /deposits  /cancel',
      s.support ? `\n💬 Need help? Contact ${esc(s.support)}` : '',
    ].join('\n'),
    { ...HTML, ...mainMenu(ctx.isAdmin) },
  );
}

async function showBalance(ctx: BotContext) {
  await clearState(ctx.dbUser._id);
  const u = await freshUser(ctx);

  await ctx.reply(
    [`💰 <b>Your wallet</b>`, LINE, `Balance: <b>${fmt(u.balance)}</b>`, `Total deposited: ${fmt(u.totalDeposited)}`, `Total spent: ${fmt(u.totalSpent)}`].join('\n'),
    {
      ...HTML,
      ...Markup.inlineKeyboard([[Markup.button.callback('➕ Recharge', 'rc:start'), Markup.button.callback('🛍 Shop', 'buy:start')]]),
    },
  );
}

// ---------- buying: catalog -> product -> quantity -> confirm ----------
async function showBuy(ctx: BotContext, page = 0) {
  await clearState(ctx.dbUser._id);
  const [u, products, stockMap] = await Promise.all([
    freshUser(ctx),
    Product.find({ active: true, columnCount: { $gt: 0 } }).sort({ name: 1 }).lean(),
    getStockMap(),
  ]);
  if (!products.length) {
    return editOrReply(ctx, `<b>${shopTitle()}</b>\n\n😔 No products are available right now. Please check back soon.`);
  }

  const pages = Math.max(1, Math.ceil(products.length / PAGE));
  const cur = Math.min(Math.max(0, page), pages - 1);
  const slice = products.slice(cur * PAGE, (cur + 1) * PAGE);

  // catalog text: name, description, price and stock of every product on this page
  const cards = slice.map((p) => {
    const left = stockMap.get(String(p._id))?.available ?? 0;
    return [
      `📦 <b>${esc(p.name)}</b>`,
      p.description ? `<i>${esc(trunc(p.description, 120))}</i>` : '',
      `💵 <b>${fmt(p.price)}</b> each  •  ${stockLabel(left)}`,
    ]
      .filter(Boolean)
      .join('\n');
  });
  const rows = slice.map((p) => {
    const left = stockMap.get(String(p._id))?.available ?? 0;
    const label = left > 0 ? `📦 ${p.name} • ${fmt(p.price)}` : `⚪ ${p.name} • sold out`;
    return [Markup.button.callback(trunc(label, 60), `buy:p:${p._id}`)];
  });
  const nav = [];
  if (cur > 0) nav.push(Markup.button.callback('⬅️ Prev', `buy:l:${cur - 1}`));
  if (pages > 1) nav.push(Markup.button.callback(`${cur + 1} / ${pages}`, 'noop'));
  if (cur + 1 < pages) nav.push(Markup.button.callback('Next ➡️', `buy:l:${cur + 1}`));
  if (nav.length) rows.push(nav);
  rows.push([Markup.button.callback('➕ Recharge', 'rc:start'), Markup.button.callback('📦 My orders', 'orders:p:0')]);
  await editOrReply(
    ctx,
    [`<b>${shopTitle()}</b>`, `💰 Your balance: <b>${fmt(u.balance)}</b>`, LINE, cards.join('\n\n'), '', 'Tap a product to see details 👇'].join('\n'),
    Markup.inlineKeyboard(rows),
  );
}

/** Quick-pick quantities that fit the product's min / max / stock. */
function quickQuantities(min: number, max: number): number[] {
  const list = [1, 5, 10, 25, 50, 100, 250, 500, 1000].filter((n) => n >= min && n <= max);
  if (!list.includes(min)) list.unshift(min);
  return list.slice(0, 6);
}

async function showProduct(ctx: BotContext, id: string) {
  const [p, u] = await Promise.all([getProduct(id), freshUser(ctx)]);
  if (!p || !p.active || p.columnCount < 1) return ctx.answerCbQuery('This product is no longer available.', { show_alert: true });
  const stock = await getProductStock(p._id);
  const range = buyRange(p, stock.available);
  if (stock.available < 1) return ctx.answerCbQuery('Sold out. Please check back later.', { show_alert: true });
  if (!range.buyable) {
    return ctx.answerCbQuery(`Only ${stock.available} left, below the minimum order of ${range.min}. Please check back later.`, { show_alert: true });
  }

  await ctx.answerCbQuery().catch(() => undefined);
  await setState(ctx.dbUser._id, 'awaiting_quantity', { productId: String(p._id) });

  const qs = quickQuantities(range.min, range.max);
  const quick = qs.map((n) => Markup.button.callback(`${n} • ${fmt(lineTotal(p.price, n))}`, `buy:q:${p._id}:${n}`));
  if (range.max > range.min && !qs.includes(range.max)) {
    quick.push(Markup.button.callback(`Max ${range.max} • ${fmt(lineTotal(p.price, range.max))}`, `buy:q:${p._id}:${range.max}`));
  }
  const rows = [];
  for (let i = 0; i < quick.length; i += 3) rows.push(quick.slice(i, i + 3));
  rows.push([Markup.button.callback('⬅️ All products', 'buy:start'), Markup.button.callback('✖️ Cancel', 'buy:cancel')]);

  const limits = describeLimits(p);
  await editOrReply(
    ctx,
    [
      `📦 <b>${esc(p.name)}</b>`,
      p.description ? `<i>${esc(p.description)}</i>` : '',
      LINE,
      `💵 Price: <b>${fmt(p.price)}</b> each`,
      `📊 Stock: ${stockLabel(stock.available)}`,
      limits ? `🔢 Per order: ${limits}` : '',
      `💰 Your balance: <b>${fmt(u.balance)}</b>`,
      '',
      range.min === range.max ? `👇 Tap the quantity below to continue.` : `✏️ <b>Tap a quantity</b> or send your own number (${range.min} – ${range.max}).`,
    ]
      .filter((l, i) => !(i === 1 && l === ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n'),
    Markup.inlineKeyboard(rows),
  );
}

export async function showConfirm(ctx: BotContext, productId: string, qty: number) {
  const [p, u] = await Promise.all([getProduct(productId), freshUser(ctx)]);
  if (!p || !p.active || p.columnCount < 1) {
    await clearState(ctx.dbUser._id);
    return ctx.reply('😔 This product is no longer available. Open 🛍 Shop to pick another one.');
  }
  const stock = await getProductStock(p._id);
  const range = buyRange(p, stock.available);
  if (stock.available < 1) {
    await clearState(ctx.dbUser._id);
    return ctx.reply('😔 Sorry, this product is sold out right now. Please check back later.');
  }
  if (!range.buyable) {
    await clearState(ctx.dbUser._id);
    return ctx.reply(`😔 Only ${stock.available} left, which is below the minimum order of ${range.min}. Please check back later.`);
  }
  if (!Number.isSafeInteger(qty) || qty < range.min || qty > range.max) {
    return ctx.reply(`Please send a number between ${range.min} and ${range.max}.`);
  }
  const total = lineTotal(p.price, qty);
  const balance = round2(u.balance);
  await clearState(ctx.dbUser._id);

  if (balance < total) {
    return editOrReply(
      ctx,
      [
        '❌ <b>Insufficient balance</b>',
        LINE,
        `${qty} × ${esc(p.name)} = <b>${fmt(total)}</b>`,
        `Your balance: ${fmt(u.balance)}`,
        `You need <b>${fmt(round2(total - balance))}</b> more.`,
      ].join('\n'),
      Markup.inlineKeyboard([
        [Markup.button.callback('➕ Recharge', 'rc:start')],
        [Markup.button.callback('⬅️ Back to product', `buy:p:${p._id}`), Markup.button.callback('🛍 Shop', 'buy:start')],
      ]),
    );
  }
  await editOrReply(
    ctx,
    [
      '🧾 <b>Order summary</b>',
      LINE,
      `📦 Product: <b>${esc(p.name)}</b>`,
      `🔢 Quantity: <b>${qty}</b>`,
      `💵 Price: ${fmt(p.price)} each`,
      LINE,
      `💳 Total: <b>${fmt(total)}</b>`,
      `💰 Balance after: ${fmt(round2(balance - total))}`,
    ].join('\n'),
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Confirm purchase', `buy:ok:${p._id}:${qty}:${round2(p.price)}`)],
      [Markup.button.callback('⬅️ Change quantity', `buy:p:${p._id}`), Markup.button.callback('✖️ Cancel', 'buy:cancel')],
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

/** Tells the admins when a product just ran out or crossed the low-stock line (setting `lowStockAlert`, 0 = off). */
async function alertLowStock(ctx: BotContext, productId: Types.ObjectId, name: string, sold: number) {
  try {
    const { lowStockAlert } = await getSettings();
    if (lowStockAlert <= 0) return;
    const left = (await getProductStock(productId)).available;
    if (left === 0) {
      await notifyAdmins(ctx.telegram, `🔴 <b>${esc(name)}</b> is now <b>sold out</b>.\nUpload more stock in /products.`);
    } else if (left + sold > lowStockAlert && left <= lowStockAlert) {
      await notifyAdmins(ctx.telegram, `⚠️ <b>Low stock:</b> ${esc(name)} has only <b>${left}</b> left.`);
    }
  } catch (e) {
    logger.warn({ err: safeError(e) }, 'Low-stock alert failed');
  }
}

async function confirmPurchase(ctx: BotContext, productId: string, qty: number, price: number) {
  await ctx.editMessageReplyMarkup(undefined).catch(() => undefined); // block double taps
  const wait = await ctx.reply('⏳ Processing your order…');
  try {
    const productObjectId = new Types.ObjectId(productId);
    const { order, rows } = await withUserLock(ctx.dbUser._id, () => purchaseProduct(ctx.dbUser._id, ctx.from!.id, productObjectId, qty, price));
    const buf = await buildDataFile(order, rows);
    const u = await freshUser(ctx);
    await ctx.replyWithDocument(
      { source: buf, filename: deliveryFileName(order.productName, shortId(order._id), qty, order.format) },
      {
        caption: [
          `✅ <b>Order #${shortId(order._id)} completed</b>`,
          LINE,
          `📦 ${esc(order.productName)} × ${qty}`,
          `💳 Paid: ${fmt(order.total)}`,
          `💰 Balance: ${fmt(u.balance)}`,
          '',
          'Thank you for your purchase! 🙌',
        ].join('\n'),
        ...HTML,
        ...Markup.inlineKeyboard([[Markup.button.callback('🛍 Shop more', 'buy:start'), Markup.button.callback('📦 My orders', 'orders:p:0')]]),
      },
    );
    await notifyAdmins(
      ctx.telegram,
      `🛒 <b>Sale</b> • ${esc(order.productName)} × ${qty} • ${fmt(order.total)}\n👤 ${esc(ctx.from!.first_name)}${ctx.from!.username ? ` @${esc(ctx.from!.username)}` : ''} (<code>${ctx.from!.id}</code>)`,
    );
    await alertLowStock(ctx, productObjectId, order.productName, qty);
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
const ORDER_ICON = { completed: '✅', processing: '⏳', failed: '❌' } as const;
const TX_LABEL: Record<string, string> = {
  deposit: '➕ Recharge',
  purchase: '🛍 Purchase',
  refund: '↩️ Refund',
  admin_credit: '🎁 Credit',
  admin_debit: '➖ Debit',
};

async function showOrders(ctx: BotContext, page = 0) {
  await clearState(ctx.dbUser._id);
  const filter = { userId: ctx.dbUser._id, status: 'completed' };
  const [orders, count] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(page * PAGE).limit(PAGE).lean(),
    Order.countDocuments(filter),
  ]);
  if (count === 0) {
    return editOrReply(ctx, '📦 <b>My orders</b>\n\nYou have no purchases yet.', Markup.inlineKeyboard([[Markup.button.callback('🛍 Browse products', 'buy:start')]]));
  }
  const rows = orders.map((o) => [
    Markup.button.callback(trunc(`#${shortId(o._id)} • ${o.productName} × ${o.quantity} • ${fmt(o.total)}`, 60), `order:v:${o._id}`),
  ]);
  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('⬅️ Prev', `orders:p:${page - 1}`));
  if ((page + 1) * PAGE < count) nav.push(Markup.button.callback('Next ➡️', `orders:p:${page + 1}`));
  if (nav.length) rows.push(nav);
  await editOrReply(ctx, `📦 <b>My orders</b> (${count})\n${LINE}\nTap an order to see details or download its file again.`, Markup.inlineKeyboard(rows));
}

async function showOrder(ctx: BotContext, id: string) {
  const o = Types.ObjectId.isValid(id) ? await Order.findOne({ _id: id, userId: ctx.dbUser._id }).lean() : null;
  if (!o) return ctx.answerCbQuery('Order not found', { show_alert: true });
  await editOrReply(
    ctx,
    [
      `📦 <b>Order #${shortId(o._id)}</b> ${ORDER_ICON[o.status]}`,
      LINE,
      `Product: <b>${esc(o.productName)}</b>`,
      `Quantity: ${o.quantity}`,
      `Unit price: ${fmt(o.unitPrice)}`,
      `Total: <b>${fmt(o.total)}</b>`,
      `Date: ${fmtDate(o.createdAt)}`,
    ].join('\n'),
    Markup.inlineKeyboard([
      [Markup.button.callback('📥 Download file again', `order:d:${o._id}`)],
      [Markup.button.callback('⬅️ My orders', 'orders:p:0')],
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
    { caption: `📦 Order #${shortId(o._id)} • ${esc(o.productName)} × ${o.quantity}`, ...HTML },
  );
}

async function showTransactions(ctx: BotContext, page = 0) {
  await clearState(ctx.dbUser._id);
  const filter = { userId: ctx.dbUser._id };
  const [txs, count] = await Promise.all([
    Transaction.find(filter).sort({ createdAt: -1 }).skip(page * 10).limit(10).lean(),
    Transaction.countDocuments(filter),
  ]);
  if (count === 0) return editOrReply(ctx, '🧾 <b>Transactions</b>\n\nNo transactions yet.');
  const lines = txs.map(
    (t) => `${TX_LABEL[t.type] ?? t.type} • <b>${fmtSigned(t.amount)}</b>\n<i>${fmtDate(t.createdAt)} • balance ${fmt(t.balanceAfter)}</i>${t.note ? `\n${esc(trunc(t.note, 80))}` : ''}`,
  );
  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('⬅️ Prev', `tx:p:${page - 1}`));
  if ((page + 1) * 10 < count) nav.push(Markup.button.callback('Next ➡️', `tx:p:${page + 1}`));
  await editOrReply(ctx, `🧾 <b>Transactions</b> (${count})\n${LINE}\n${lines.join('\n\n')}`, nav.length ? Markup.inlineKeyboard([nav]) : {});
}

async function showDeposits(ctx: BotContext) {
  await clearState(ctx.dbUser._id);
  const deps = await Deposit.find({ userId: ctx.dbUser._id }).sort({ createdAt: -1 }).limit(10).lean();
  if (!deps.length) return ctx.reply('📥 No recharge requests yet.');
  const icon = { verified: '✅', failed: '❌', processing: '⏳' } as const;
  const lines = deps.map(
    (d) => `${icon[d.status]} ${d.method.toUpperCase()} • <code>${esc(d.trxId)}</code> • ${fmt(d.verifiedAmount ?? d.claimedAmount)}\n${fmtDate(d.createdAt)}`,
  );
  await ctx.reply(`📥 <b>Recharge history</b>\n${LINE}\n${lines.join('\n\n')}`, HTML);
}

/** Welcome screen (/start, and right after a user passes the channel check). */
export async function showWelcome(ctx: BotContext) {
  await clearState(ctx.dbUser._id);
  // only what customers can actually buy: visible, ready products
  const [visible, stockMap, u] = await Promise.all([Product.find({ active: true, columnCount: { $gt: 0 } }).select('_id').lean(), getStockMap(), freshUser(ctx)]);
  const products = visible.length;
  const inStock = visible.reduce((n, p) => n + (stockMap.get(String(p._id))?.available ?? 0), 0);
  await replyWithLogo(ctx,
    [
      `<b>${shopTitle()}</b>`,
      LINE,
      `👋 Welcome, <b>${esc(ctx.from?.first_name)}</b>!`,
      '',
      `💰 Wallet: <b>${fmt(u.balance)}</b>`,
      `🗂 Products: <b>${products}</b>   📦 In stock: <b>${inStock}</b>`,
      '',
      '<b>How it works</b>',
      '1️⃣ ➕ Recharge your wallet',
      '2️⃣ 🛍 Pick a product and quantity',
      '3️⃣ 📥 Get your file instantly',
      '',
      'Use the menu below 👇',
    ].join('\n'),
    mainMenu(ctx.isAdmin),
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
  bot.command(['shop', 'buy', 'browse'], (ctx) => showBuy(ctx, 0));
  bot.hears([BTN.buy, '🛒 Buy', '🛒 Buy Emails'], (ctx) => showBuy(ctx, 0)); // old keyboard labels still work
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
