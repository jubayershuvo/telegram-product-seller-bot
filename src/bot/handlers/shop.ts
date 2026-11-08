import { Markup, Telegraf } from 'telegraf';
import { Types } from 'mongoose';
import { BotContext } from '../context';
import { BTN, HTML, clearState, editOrReply, esc, mainMenu, setState, shortId } from '../ui';
import { getSettings } from '../../services/settings';
import { getStock, getOrderEmails, maxBuyable } from '../../services/inventory';
import { purchaseEmails } from '../../services/purchase';
import { buildEmailWorkbook } from '../../services/excel';
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
      '2. 🛒 Choose how many emails you want',
      '3. Confirm — you instantly receive an Excel (.xlsx) file',
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

// ---------- buying (always custom quantity) ----------
async function showBuy(ctx: BotContext) {
  await clearState(ctx.dbUser._id);
  const [s, stock, u] = await Promise.all([getSettings(), getStock(), freshUser(ctx)]);
  const max = maxBuyable(stock.available, s.maxQty);
  if (max < 1) {
    return editOrReply(ctx, '😔 Sorry, emails are out of stock right now. Please check back later.');
  }
  await setState(ctx.dbUser._id, 'awaiting_quantity');
  await editOrReply(
    ctx,
    [
      '🛒 <b>Buy Emails</b>',
      '',
      `📦 In stock: <b>${stock.available}</b>`,
      `💵 Price: <b>${fmt(s.price)}</b> per email`,
      `💰 Your balance: <b>${fmt(u.balance)}</b>`,
      '',
      `✏️ Send the number of emails you want (1 – ${max}).`,
      '/cancel to stop.',
    ].join('\n'),
    Markup.inlineKeyboard([[Markup.button.callback('✖️ Cancel', 'buy:cancel')]]),
  );
}

export async function showConfirm(ctx: BotContext, qty: number) {
  const [s, stock, u] = await Promise.all([getSettings(), getStock(), freshUser(ctx)]);
  const max = maxBuyable(stock.available, s.maxQty);
  if (max < 1) {
    await clearState(ctx.dbUser._id);
    return ctx.reply('😔 Sorry, emails are out of stock right now. Please check back later.');
  }
  if (!Number.isSafeInteger(qty) || qty < 1) return ctx.reply(`Please send a number between 1 and ${max}.`);
  if (qty > max) return ctx.reply(`Please send a number between 1 and ${max}.`);
  const total = lineTotal(s.price, qty);
  const balance = round2(u.balance);
  await clearState(ctx.dbUser._id);

  if (balance < total) {
    return editOrReply(
      ctx,
      `❌ <b>Insufficient balance</b>\n\n${qty} emails = <b>${fmt(total)}</b>\nYour balance: ${fmt(u.balance)}\nYou need <b>${fmt(round2(total - balance))}</b> more.`,
      Markup.inlineKeyboard([[Markup.button.callback('➕ Recharge', 'rc:start')]]),
    );
  }
  await editOrReply(
    ctx,
    `🧾 <b>Confirm purchase</b>\n\nQuantity: <b>${qty}</b>\nPrice: ${fmt(s.price)} each\nTotal: <b>${fmt(total)}</b>\nBalance after: ${fmt(round2(balance - total))}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Confirm', `buy:ok:${qty}:${round2(s.price)}`), Markup.button.callback('✖️ Cancel', 'buy:cancel')],
    ]),
  );
}

export async function handleQuantityInput(ctx: BotContext, text: string) {
  const t = text.trim();
  if (!/^\d+$/.test(t) || t.length > 15) return ctx.reply('Please send a whole number, e.g. 25. (/cancel to stop)');
  return showConfirm(ctx, parseInt(t, 10));
}

async function confirmPurchase(ctx: BotContext, qty: number, price: number) {
  await ctx.editMessageReplyMarkup(undefined).catch(() => undefined); // block double taps
  const wait = await ctx.reply('⏳ Processing your order…');
  try {
    const { order, addresses } = await withUserLock(ctx.dbUser._id, () =>
      purchaseEmails(ctx.dbUser._id, ctx.from!.id, qty, price),
    );
    const buf = await buildEmailWorkbook(addresses);
    const u = await freshUser(ctx);
    await ctx.replyWithDocument(
      { source: buf, filename: `emails_${shortId(order._id)}_${qty}.xlsx` },
      { caption: `✅ <b>Order #${shortId(order._id)} completed</b>\n${qty} emails • ${fmt(order.total)}\nBalance: ${fmt(u.balance)}`, ...HTML },
    );
    await notifyAdmins(ctx.telegram, `🛒 Sale: ${qty} emails • ${fmt(order.total)} • user <code>${ctx.from!.id}</code>`);
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
    Markup.button.callback(`#${shortId(o._id)} • ${o.quantity} emails • ${fmt(o.total)}`, `order:v:${o._id}`),
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
    `📦 <b>Order #${shortId(o._id)}</b>\n\nStatus: ${o.status}\nQuantity: ${o.quantity}\nUnit price: ${fmt(o.unitPrice)}\nTotal: ${fmt(o.total)}\nDate: ${fmtDate(o.createdAt)}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('📥 Download file again', `order:d:${o._id}`)],
      [Markup.button.callback('⬅️ Back', 'orders:p:0')],
    ]),
  );
}

async function downloadOrder(ctx: BotContext, id: string) {
  const o = Types.ObjectId.isValid(id) ? await Order.findOne({ _id: id, userId: ctx.dbUser._id, status: 'completed' }).lean() : null;
  if (!o) return ctx.answerCbQuery('Order not found', { show_alert: true });
  const addresses = await getOrderEmails(o._id, ctx.dbUser._id);
  const buf = await buildEmailWorkbook(addresses);
  await ctx.replyWithDocument({ source: buf, filename: `emails_${shortId(o._id)}_${o.quantity}.xlsx` }, { caption: `Order #${shortId(o._id)}` });
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
  const [s, stock, u] = await Promise.all([getSettings(), getStock(), freshUser(ctx)]);
  await ctx.reply(
    [
      `👋 Welcome <b>${esc(ctx.from?.first_name)}</b>!`,
      '',
      `💰 Balance: <b>${fmt(u.balance)}</b>`,
      `💵 Price: <b>${fmt(s.price)}</b> per email`,
      `📦 In stock: <b>${stock.available}</b>`,
      '',
      '➕ Recharge → 🛒 Buy Emails → get your Excel file instantly.',
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
  bot.command('buy', showBuy);
  bot.command('browse', showBuy);
  bot.hears(BTN.buy, showBuy);
  bot.command('orders', (ctx) => showOrders(ctx, 0));
  bot.hears(BTN.orders, (ctx) => showOrders(ctx, 0));
  bot.command('transactions', (ctx) => showTransactions(ctx, 0));
  bot.hears(BTN.tx, (ctx) => showTransactions(ctx, 0));
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
    await clearState(ctx.dbUser._id);
    await ctx.editMessageText('Cancelled.').catch(() => undefined);
  });
  bot.action('buy:cancel', async (ctx) => {
    await ctx.answerCbQuery('Cancelled');
    await clearState(ctx.dbUser._id);
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
