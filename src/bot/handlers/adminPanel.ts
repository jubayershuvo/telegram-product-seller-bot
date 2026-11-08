import { Markup, Telegraf } from 'telegraf';
import { Types } from 'mongoose';
import { BotContext } from '../context';
import { BTN, HTML, clearState, commandArgs, editOrReply, esc, setState, shortId, userLabel } from '../ui';
import { adminOnly } from '../middlewares/auth';
import { env } from '../../config/env';
import { getSettings } from '../../services/settings';
import { describeRecharge, getRechargeStatus, setRechargeEnabled, setRechargeHours, setRechargeScheduleEnabled } from '../../services/rechargeGate';
import { parseSettingInput } from '../../services/settingsParser';
import { SETTING_DEFS } from '../../models/Setting';
import { getStats } from '../../services/stats';
import { creditWallet, debitWallet } from '../../services/wallet';
import { User } from '../../models/User';
import { Order } from '../../models/Order';
import { Deposit } from '../../models/Deposit';
import { Transaction } from '../../models/Transaction';
import { ImportBatch } from '../../models/ImportBatch';
import { fmt, fmtDate, fmtSigned, parseAmount, round2 } from '../../utils/money';

type Btn = ReturnType<typeof Markup.button.callback>;
const cb = Markup.button.callback;
const PAGE = 8;
const trunc = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const panelBack: Btn[] = [cb('⬅️ Admin panel', 'ap:home')];

export const HELP = `<b>🛠 Admin commands</b>
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
export async function showPanel(ctx: BotContext) {
  await clearState(ctx.dbUser._id);
  const [st, s] = await Promise.all([getStats(), getSettings()]);
  await editOrReply(
    ctx,
    [
      '🛠 <b>Admin panel</b>',
      '',
      `📦 In stock: <b>${st.stock.available}</b> / ${st.stock.total}   💵 Price: <b>${fmt(s.price)}</b>`,
      `👥 Users: <b>${st.users}</b>   🛍 Sold: <b>${st.sales.emails}</b> emails`,
      `💳 Recharge: ${describeRecharge(s)}`,
      '',
      'Choose an action 👇',
    ].join('\n'),
    Markup.inlineKeyboard([
      [cb(s.rechargeEnabled ? '🟢 Recharge ON — tap to turn OFF' : '🔴 Recharge OFF — tap to turn ON', 'rcx:t:p')],
      [cb('⏰ Recharge schedule', 'rcx:home')],
      [cb('🚫 Ban / Unban user', 'ab:search'), cb('📋 Banned list', 'bn:0')],
      [cb('💰 Add / Deduct balance', 'ab:p:0')],
      [cb('📊 Stats', 'ap:stats'), cb('👥 Users', 'ab:p:0')],
      [cb('🛍 Orders', 'ap:o:0'), cb('💳 Deposits', 'ap:d:0')],
      [cb('🧾 Transactions', 'ap:t:0'), cb('📥 Import emails', 'ap:imp')],
      [cb('📣 Broadcast', 'bc:start'), cb('📢 Channels', 'fc:home')],
      [cb('⚙️ Settings', 'se:home'), cb('📖 Commands', 'ap:help')],
    ]),
  );
}

async function showStatsScreen(ctx: BotContext) {
  const [s, st] = await Promise.all([getStats(), getSettings()]);
  await editOrReply(
    ctx,
    [
      '📊 <b>Statistics</b>',
      '',
      `📧 Emails total: <b>${s.stock.total}</b>`,
      `🟢 Available: <b>${s.stock.available}</b>`,
      `🔴 Sold: <b>${s.stock.sold}</b>`,
      `💵 Price: <b>${fmt(st.price)}</b>`,
      '',
      `👥 Users: ${s.users} (banned: ${s.banned})`,
      `📥 Verified deposits: ${s.deposits.count} • ${fmt(s.deposits.sum)}`,
      `🛍 Orders: ${s.sales.orders} • ${s.sales.emails} emails • ${fmt(s.sales.revenue)}`,
    ].join('\n'),
    Markup.inlineKeyboard([[cb('🔄 Refresh', 'ap:stats')], panelBack]),
  );
}

function pager(prefix: string, page: number, count: number): Btn[] {
  const nav: Btn[] = [];
  if (page > 0) nav.push(cb('⬅️ Prev', `${prefix}:${page - 1}`));
  if ((page + 1) * PAGE < count) nav.push(cb('Next ➡️', `${prefix}:${page + 1}`));
  return nav;
}

async function showOrdersScreen(ctx: BotContext, page: number) {
  const [list, count] = await Promise.all([
    Order.find().sort({ createdAt: -1 }).skip(page * PAGE).limit(PAGE).lean(),
    Order.countDocuments(),
  ]);
  const lines = list.map((o) => `#${shortId(o._id)} • <code>${o.telegramId}</code> • ${o.quantity} × ${fmt(o.unitPrice)} = <b>${fmt(o.total)}</b> • ${o.status}\n${fmtDate(o.createdAt)}`);
  const rows = [pager('ap:o', page, count), panelBack].filter((r) => r.length);
  await editOrReply(ctx, `🛍 <b>Orders</b> (${count}) • page ${page + 1}\n\n${lines.join('\n\n') || '-'}`, Markup.inlineKeyboard(rows));
}

async function showDepositsScreen(ctx: BotContext, page: number) {
  const [list, count] = await Promise.all([
    Deposit.find().sort({ createdAt: -1 }).skip(page * PAGE).limit(PAGE).lean(),
    Deposit.countDocuments(),
  ]);
  const icon = { verified: '✅', failed: '❌', processing: '⏳' } as const;
  const lines = list.map(
    (d) => `${icon[d.status]} ${d.method} • <code>${d.telegramId}</code> • <code>${esc(d.trxId)}</code> • ${fmt(d.verifiedAmount ?? d.claimedAmount)}${d.failReason ? `\n<i>${esc(d.failReason.slice(0, 80))}</i>` : ''}\n${fmtDate(d.createdAt)}`,
  );
  const rows = [pager('ap:d', page, count), panelBack].filter((r) => r.length);
  await editOrReply(ctx, `💳 <b>Deposits</b> (${count}) • page ${page + 1}\n\n${lines.join('\n\n') || '-'}`, Markup.inlineKeyboard(rows));
}

async function showTxScreen(ctx: BotContext, page: number) {
  const [list, count] = await Promise.all([
    Transaction.find().sort({ createdAt: -1 }).skip(page * PAGE).limit(PAGE).lean(),
    Transaction.countDocuments(),
  ]);
  const lines = list.map((t) => `<code>${t.telegramId}</code> • ${t.type} • <b>${fmtSigned(t.amount)}</b> • bal ${fmt(t.balanceAfter)}\n${fmtDate(t.createdAt)}`);
  const rows = [pager('ap:t', page, count), panelBack].filter((r) => r.length);
  await editOrReply(ctx, `🧾 <b>Transactions</b> (${count}) • page ${page + 1}\n\n${lines.join('\n\n') || '-'}`, Markup.inlineKeyboard(rows));
}

async function showImportInfo(ctx: BotContext) {
  const [s, list] = await Promise.all([getSettings(), ImportBatch.find().sort({ createdAt: -1 }).limit(5).lean()]);
  const recent = list.map((b) => `${fmtDate(b.createdAt)} • ${esc(b.fileName)}\n+${b.inserted} new, ${b.duplicatesInDb} existing, ${b.duplicatesInFile} dup`);
  await editOrReply(
    ctx,
    [
      '📥 <b>Import emails</b>',
      '',
      '1. Prepare an <b>.xlsx</b> file: emails in <b>Column A</b>, one per row',
      `2. Send it to this chat as a <b>file</b> (max ${s.maxUploadMb} MB)`,
      '3. The bot imports it and shows a report',
      '',
      recent.length ? `<b>Recent imports</b>\n${recent.join('\n\n')}` : 'No imports yet.',
    ].join('\n'),
    Markup.inlineKeyboard([panelBack]),
  );
}

// =====================================================================
//  Balance flow: pick user → Credit / Debit → amount → confirm
// =====================================================================
const who = (u: { firstName?: string; username?: string }) => `${u.firstName || 'User'}${u.username ? ` @${u.username}` : ''}`;

function userButtons(users: { _id: unknown; firstName?: string; username?: string; balance: number; isBanned?: boolean }[]): Btn[][] {
  return users.map((u) => [cb(trunc(`${u.isBanned ? '🚫 ' : ''}${who(u)} • ${fmt(u.balance)}`, 60), `ab:u:${u._id}`)]);
}

export async function showUserPicker(ctx: BotContext, page = 0) {
  await clearState(ctx.dbUser._id);
  const [list, count] = await Promise.all([
    User.find().sort({ lastSeenAt: -1, createdAt: -1 }).skip(page * PAGE).limit(PAGE).lean(),
    User.countDocuments(),
  ]);
  const pages = Math.max(1, Math.ceil(count / PAGE));
  const rows = userButtons(list);
  const nav = pager('ab:p', page, count);
  if (nav.length) rows.push(nav);
  rows.push([cb('🔎 Search user', 'ab:search')]);
  rows.push(panelBack);
  await editOrReply(
    ctx,
    `👥 <b>Select a user</b>\n${count} users • page ${page + 1}/${pages}\n\nTap a user to credit or debit their balance, or use search.`,
    Markup.inlineKeyboard(rows),
  );
}

async function showUserCard(ctx: BotContext, id: string, notice?: string) {
  const u = Types.ObjectId.isValid(id) ? await User.findById(id).lean() : null;
  if (!u) return editOrReply(ctx, 'User not found.', Markup.inlineKeyboard([[cb('⬅️ Users', 'ab:p:0')]]));
  await clearState(ctx.dbUser._id);
  const isAdminUser = env.ADMIN_IDS.includes(u.telegramId);
  const rows: Btn[][] = [
    [cb('➕ Credit', `ab:c:${u._id}:c`), cb('➖ Debit', `ab:c:${u._id}:d`)],
  ];
  if (!isAdminUser) rows.push([cb(u.isBanned ? '✅ Unban user' : '🚫 Ban user', `ab:b:${u._id}`)]);
  else rows.push([cb('🛡 Admin — cannot be banned', 'ab:noop')]);
  rows.push([cb('⬅️ Users', 'ab:p:0'), cb('🛠 Panel', 'ap:home')]);
  await editOrReply(
    ctx,
    [
      notice ?? '',
      `👤 ${userLabel(u)}${u.isBanned ? ' 🚫 <b>BANNED</b>' : ''}`,
      '',
      `💰 Balance: <b>${fmt(u.balance)}</b>`,
      `📥 Deposited: ${fmt(u.totalDeposited)}`,
      `🛍 Spent: ${fmt(u.totalSpent)}`,
      `📅 Joined: ${fmtDate(u.createdAt)}`,
    ]
      .filter((l, i) => !(i === 0 && l === ''))
      .join('\n'),
    Markup.inlineKeyboard(rows),
  );
}

async function askAmount(ctx: BotContext, id: string, sign: 'c' | 'd') {
  const u = Types.ObjectId.isValid(id) ? await User.findById(id).lean() : null;
  if (!u) return editOrReply(ctx, 'User not found.', Markup.inlineKeyboard([[cb('⬅️ Users', 'ab:p:0')]]));
  const s = await getSettings();
  await setState(ctx.dbUser._id, 'awaiting_balance_amount', { userId: id, sign });
  const quick = s.rechargePresets.slice(0, 5).map((a) => cb(fmt(a), `ab:q:${a}`));
  const rows: Btn[][] = [];
  if (quick.length) rows.push(quick);
  rows.push([cb('⬅️ Back', `ab:u:${id}`)]);
  await editOrReply(
    ctx,
    [
      `${sign === 'c' ? '➕ <b>Credit</b>' : '➖ <b>Debit</b>'} — ${esc(who(u))}`,
      `Current balance: <b>${fmt(u.balance)}</b>`,
      '',
      '✏️ <b>Send the amount</b> as a message, or tap a quick amount.',
      '/cancel to stop.',
    ].join('\n'),
    Markup.inlineKeyboard(rows),
  );
}

async function confirmAmount(ctx: BotContext, amount: number) {
  const st = ctx.dbUser.state;
  const id = String(st?.data?.userId ?? '');
  const sign: 'c' | 'd' = st?.data?.sign === 'd' ? 'd' : 'c';
  const u = Types.ObjectId.isValid(id) ? await User.findById(id).lean() : null;
  if (!u || st?.name !== 'awaiting_balance_amount') return ctx.reply('Session expired. Open /admin again.');
  if (sign === 'd' && amount > u.balance) {
    return ctx.reply(`❌ User balance is only ${fmt(u.balance)}. Send a smaller amount.`);
  }
  const after = round2(sign === 'c' ? u.balance + amount : u.balance - amount);
  await clearState(ctx.dbUser._id);
  await editOrReply(
    ctx,
    [
      '🧾 <b>Confirm</b>',
      '',
      `${sign === 'c' ? '➕ Credit' : '➖ Debit'} <b>${fmt(amount)}</b>`,
      `User: ${esc(who(u))} (<code>${u.telegramId}</code>)`,
      `Balance: ${fmt(u.balance)} → <b>${fmt(after)}</b>`,
    ].join('\n'),
    Markup.inlineKeyboard([[cb('✅ Confirm', `ab:ok:${sign}:${amount}:${u._id}`), cb('✖️ Cancel', `ab:u:${u._id}`)]]),
  );
}

async function applyBalance(ctx: BotContext, sign: 'c' | 'd', amount: number, id: string) {
  const u = Types.ObjectId.isValid(id) ? await User.findById(id) : null;
  if (!u || !Number.isFinite(amount) || amount <= 0 || round2(amount) !== amount) return ctx.reply('Invalid request.');
  await ctx.editMessageReplyMarkup(undefined).catch(() => undefined); // block double taps
  const msg = ctx.callbackQuery && 'message' in ctx.callbackQuery ? ctx.callbackQuery.message : undefined;
  // deterministic key per confirm message => a double tap can never apply the change twice
  const opKey = `admin:${msg?.chat.id ?? 0}:${msg?.message_id ?? Date.now()}`;
  const op = {
    userId: u._id,
    amount,
    opKey,
    type: sign === 'c' ? ('admin_credit' as const) : ('admin_debit' as const),
    note: `admin ${ctx.from!.id}`,
  };
  const r = sign === 'c' ? await creditWallet(op) : await debitWallet(op);
  if (!r.ok) {
    const text = r.reason === 'insufficient' ? '❌ User balance is lower than that amount.' : r.reason === 'duplicate' ? 'ℹ️ This change was already applied.' : '❌ Failed.';
    return showUserCard(ctx, id, text);
  }
  await ctx.telegram
    .sendMessage(u.telegramId, `💰 Your wallet was ${sign === 'c' ? 'credited' : 'debited'} ${fmt(amount)} by admin.\nNew balance: ${fmt(r.balanceAfter ?? 0)}`)
    .catch(() => undefined);
  await ctx.reply(`✅ ${sign === 'c' ? 'Credited' : 'Debited'} <b>${fmt(amount)}</b> — new balance <b>${fmt(r.balanceAfter ?? 0)}</b>`, HTML);
  await ctx.reply('What next?', Markup.inlineKeyboard([[cb('👤 Back to user', `ab:u:${id}`), cb('👥 Users', 'ab:p:0')]]));
}

/** Text router: admin typed the amount. */
export async function handleBalanceAmountInput(ctx: BotContext, text: string) {
  if (!ctx.isAdmin) return ctx.reply('⛔ Admin only.');
  const amount = parseAmount(text);
  if (!amount) return ctx.reply('Please send a valid amount, e.g. 100 or 10.50 (/cancel to stop)');
  return confirmAmount(ctx, amount);
}

/** Text router: admin typed a search query. */
export async function handleUserSearchInput(ctx: BotContext, text: string) {
  if (!ctx.isAdmin) return ctx.reply('⛔ Admin only.');
  const q = text.trim().replace(/^@/, '');
  const esc2 = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const filter = /^\d+$/.test(q)
    ? { telegramId: Number(q) }
    : { $or: [{ username: new RegExp(esc2, 'i') }, { firstName: new RegExp(esc2, 'i') }, { lastName: new RegExp(esc2, 'i') }] };
  const users = await User.find(filter).sort({ lastSeenAt: -1 }).limit(PAGE).lean();
  if (!users.length) return ctx.reply('No user found. Try another ID / @username / name, or /cancel.');
  if (users.length === 1) return showUserCard(ctx, String(users[0]._id));
  await clearState(ctx.dbUser._id);
  const rows = userButtons(users);
  rows.push([cb('⬅️ Users', 'ab:p:0')]);
  await ctx.reply(`🔎 <b>${users.length} users found</b> — tap one:`, { ...HTML, ...Markup.inlineKeyboard(rows) });
}

// =====================================================================
//  Recharge control: on/off for everyone + daily schedule
// =====================================================================
async function showRechargeControl(ctx: BotContext, notice?: string) {
  await clearState(ctx.dbUser._id);
  const s = await getSettings();
  const st = await getRechargeStatus();
  await editOrReply(
    ctx,
    [
      notice ?? '',
      '💳 <b>Recharge control</b>',
      '',
      `Status now: ${st.open ? '🟢 <b>OPEN</b>' : '🔴 <b>CLOSED</b>'}`,
      `Master switch: <b>${s.rechargeEnabled ? 'ON' : 'OFF'}</b>  <i>(OFF closes recharge for all users immediately)</i>`,
      `Daily schedule: <b>${s.rechargeScheduleEnabled ? `ON — ${s.rechargeOpenTime} to ${s.rechargeCloseTime}` : 'OFF'}</b>  (${esc(s.timezone)})`,
      '',
      'Recharge is open only when the master switch is ON <b>and</b> (if the schedule is ON) the time is inside the daily hours.',
    ]
      .filter((l, i) => !(i === 0 && l === ''))
      .join('\n'),
    Markup.inlineKeyboard([
      [cb(s.rechargeEnabled ? '🔴 Turn recharge OFF' : '🟢 Turn recharge ON', 'rcx:t:c')],
      [cb(s.rechargeScheduleEnabled ? '⏰ Schedule: ON → turn OFF' : '⏰ Schedule: OFF → turn ON', 'rcx:s')],
      [cb('✏️ Set daily hours', 'rcx:h')],
      panelBack,
    ]),
  );
}

/** Text router: admin typed daily hours like "09:00-22:00". */
export async function handleRechargeHoursInput(ctx: BotContext, text: string) {
  if (!ctx.isAdmin) return ctx.reply('⛔ Admin only.');
  const hours = parseHours(text);
  if (!hours) return ctx.reply('Send the hours as <code>09:00-22:00</code> (24h). /cancel to stop.', HTML);
  await setRechargeHours(hours[0], hours[1]);
  return showRechargeControl(ctx, `✅ Daily hours set: ${hours[0]} – ${hours[1]}`);
}

function parseHours(text: string): [string, string] | null {
  const m = text.trim().match(/^(\d{1,2}:\d{2})\s*(?:-|–|to|\s)\s*(\d{1,2}:\d{2})$/i);
  if (!m) return null;
  const def = SETTING_DEFS.find((d) => d.key === 'rechargeOpenTime')!;
  const a = parseSettingInput(def, m[1]);
  const b = parseSettingInput(def, m[2]);
  if (!a.ok || !b.ok || a.value === b.value) return null;
  return [a.value as string, b.value as string];
}

// =====================================================================
//  Banned users list (unban in one tap)
// =====================================================================
async function showBannedScreen(ctx: BotContext, page: number) {
  const filter = { isBanned: true };
  const [list, count] = await Promise.all([
    User.find(filter).sort({ updatedAt: -1 }).skip(page * PAGE).limit(PAGE).lean(),
    User.countDocuments(filter),
  ]);
  const rows: Btn[][] = list.map((u) => [cb(trunc(`🚫 ${who(u)} • ${u.telegramId}`, 60), `ab:u:${u._id}`)]);
  const nav = pager('bn', page, count);
  if (nav.length) rows.push(nav);
  rows.push(panelBack);
  await editOrReply(
    ctx,
    `🚫 <b>Banned users</b> (${count})\n\n${count ? 'Tap a user to unban or view.' : 'No banned users.'}`,
    Markup.inlineKeyboard(rows),
  );
}

async function notifyBanChange(ctx: BotContext, telegramId: number, banned: boolean) {
  await ctx.telegram
    .sendMessage(telegramId, banned ? '🚫 Your account has been suspended.' : '✅ Your account has been restored. You can use the bot again.')
    .catch(() => undefined);
}

export function registerAdminPanel(bot: Telegraf<BotContext>) {
  bot.hears(BTN.admin, adminOnly, showPanel);

  const act = (re: RegExp | string, fn: (ctx: any) => Promise<unknown>) =>
    bot.action(re, adminOnly, async (ctx: any) => {
      await ctx.answerCbQuery().catch(() => undefined);
      await fn(ctx);
    });

  act('ap:home', showPanel);
  act('ap:stats', showStatsScreen);
  act('ap:imp', showImportInfo);
  act('ap:help', (ctx) => editOrReply(ctx, HELP, Markup.inlineKeyboard([panelBack])));
  act(/^ap:o:(\d+)$/, (ctx) => showOrdersScreen(ctx, parseInt(ctx.match[1], 10)));
  act(/^ap:d:(\d+)$/, (ctx) => showDepositsScreen(ctx, parseInt(ctx.match[1], 10)));
  act(/^ap:t:(\d+)$/, (ctx) => showTxScreen(ctx, parseInt(ctx.match[1], 10)));

  act(/^ab:p:(\d+)$/, (ctx) => showUserPicker(ctx, parseInt(ctx.match[1], 10)));
  act('ab:search', async (ctx) => {
    await setState(ctx.dbUser._id, 'awaiting_user_search');
    await editOrReply(ctx, '🔎 <b>Find user</b> (to ban / unban or edit balance)\n\nSend a Telegram ID, @username or name. The user card will have a 🚫 Ban / ✅ Unban button.\n/cancel to stop.', Markup.inlineKeyboard([[cb('⬅️ Users', 'ab:p:0')]]));
  });
  act(/^ab:u:([a-f0-9]{24})$/, (ctx) => showUserCard(ctx, ctx.match[1]));
  act(/^ab:c:([a-f0-9]{24}):(c|d)$/, (ctx) => askAmount(ctx, ctx.match[1], ctx.match[2]));
  act(/^ab:q:(\d+(?:\.\d{1,2})?)$/, (ctx) => confirmAmount(ctx, parseFloat(ctx.match[1])));
  act(/^ab:ok:(c|d):(\d+(?:\.\d{1,2})?):([a-f0-9]{24})$/, (ctx) => applyBalance(ctx, ctx.match[1], parseFloat(ctx.match[2]), ctx.match[3]));
  act(/^ab:b:([a-f0-9]{24})$/, async (ctx) => {
    const u = await User.findById(ctx.match[1]);
    if (!u) return showUserPicker(ctx);
    if (env.ADMIN_IDS.includes(u.telegramId)) return showUserCard(ctx, String(u._id), '⚠️ You cannot ban an admin.');
    await User.updateOne({ _id: u._id }, { isBanned: !u.isBanned });
    await notifyBanChange(ctx, u.telegramId, !u.isBanned);
    return showUserCard(ctx, String(u._id), u.isBanned ? '✅ User unbanned.' : '🚫 User banned.');
  });
  bot.action('ab:noop', adminOnly, (ctx) => ctx.answerCbQuery('Admins cannot be banned. Test with a non-admin user.', { show_alert: true }));
  act(/^bn:(\d+)$/, (ctx) => showBannedScreen(ctx, parseInt(ctx.match[1], 10)));
  bot.command('banned', adminOnly, (ctx) => showBannedScreen(ctx, 0));

  // ----- recharge control -----
  act('rcx:home', (ctx) => showRechargeControl(ctx));
  act(/^rcx:t:(p|c)$/, async (ctx) => {
    const on = !(await getSettings()).rechargeEnabled;
    await setRechargeEnabled(on);
    const notice = on ? '🟢 Recharge turned ON for all users.' : '🔴 Recharge turned OFF for all users.';
    return ctx.match[1] === 'p' ? showPanel(ctx) : showRechargeControl(ctx, notice);
  });
  act('rcx:s', async (ctx) => {
    const on = !(await getSettings()).rechargeScheduleEnabled;
    await setRechargeScheduleEnabled(on);
    return showRechargeControl(ctx, on ? '⏰ Daily schedule turned ON.' : '⏰ Daily schedule turned OFF (recharge follows the master switch only).');
  });
  act('rcx:h', async (ctx) => {
    await setState(ctx.dbUser._id, 'awaiting_recharge_hours');
    await editOrReply(
      ctx,
      '✏️ <b>Daily recharge hours</b>\n\nSend the opening and closing time, e.g. <code>09:00-22:00</code> (24h, shop timezone).\nAn overnight window such as <code>22:00-06:00</code> also works.\n/cancel to stop.',
      Markup.inlineKeyboard([[cb('⬅️ Back', 'rcx:home')]]),
    );
  });

  // ----- commands -----
  bot.command('recharge_on', adminOnly, async (ctx) => {
    await setRechargeEnabled(true);
    await ctx.reply('🟢 Recharge turned ON for all users.');
  });
  bot.command('recharge_off', adminOnly, async (ctx) => {
    await setRechargeEnabled(false);
    await ctx.reply('🔴 Recharge turned OFF for all users.');
  });
  // /recharge_hours 09:00 22:00   |   /recharge_hours off
  bot.command('recharge_hours', adminOnly, async (ctx) => {
    const raw = commandArgs(ctx).join(' ');
    if (/^off$/i.test(raw.trim())) {
      await setRechargeScheduleEnabled(false);
      return ctx.reply('⏰ Daily schedule turned OFF.');
    }
    const hours = parseHours(raw);
    if (!hours) return ctx.reply('Usage: /recharge_hours 09:00 22:00   (or /recharge_hours off)');
    await setRechargeHours(hours[0], hours[1]);
    return ctx.reply(`⏰ Recharge open daily ${hours[0]} – ${hours[1]}.`);
  });
  bot.command('recharge_status', adminOnly, async (ctx) => ctx.reply(`💳 Recharge: ${describeRecharge(await getSettings())}`));
}
