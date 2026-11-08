import axios from 'axios';
import { Markup, Telegraf } from 'telegraf';
import { BotContext } from '../context';
import { registerAdminPanel, showPanel, showUserPicker } from './adminPanel';
import { HTML, clearState, commandArgs, editOrReply, esc, setState, shortId, userLabel } from '../ui';
import { adminOnly } from '../middlewares/auth';
import { env } from '../../config/env';
import { getSettings, setSetting, resetSetting } from '../../services/settings';
import { parseSettingInput, crossCheck } from '../../services/settingsParser';
import { SETTING_DEFAULTS, SETTING_DEFS, SettingDef } from '../../models/Setting';
import { getStats } from '../../services/stats';
import { importEmails } from '../../services/excel';
import { creditWallet, debitWallet, newOpKey } from '../../services/wallet';
import { User, UserDoc } from '../../models/User';
import { Order } from '../../models/Order';
import { Deposit } from '../../models/Deposit';
import { Transaction } from '../../models/Transaction';
import { ImportBatch } from '../../models/ImportBatch';
import { AppError, safeError } from '../../utils/errors';
import { fmt, fmtDate, fmtSigned, parseAmount } from '../../utils/money';
import { logger } from '../../utils/logger';

const PAGE = 10;
const pageArg = (a: string[]) => Math.max(1, parseInt(a[0] ?? '1', 10) || 1);

const ALIASES: Record<string, string> = {
  bkash: 'bkashnumber',
  nagad: 'nagadnumber',
  currency: 'currencysymbol',
  presets: 'rechargepresets',
  maxupload: 'maxuploadmb',
  forcejoin: 'forcejoinenabled',
  trxregex: 'trxidregex',
};

function findDef(raw: string | undefined): SettingDef | undefined {
  if (!raw) return undefined;
  const k = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  const name = ALIASES[k] ?? k;
  return SETTING_DEFS.find((d) => d.key.toLowerCase() === name);
}

function show(d: SettingDef, v: unknown): string {
  if (d.secret) return v ? '••••••' : '-';
  let out: string;
  if (Array.isArray(v)) out = v.join(', ');
  else if (d.key === 'price' || d.key === 'minRecharge' || d.key === 'maxRecharge') out = fmt(v as number);
  else if (d.key === 'maxQty') out = v === 0 ? '0 (no cap, limited by stock)' : String(v);
  else out = String(v ?? '');
  if (out === '') return '-';
  return out.length > 70 ? `${out.slice(0, 70)}…` : out;
}

async function findUser(q: string | undefined): Promise<UserDoc | null> {
  if (!q) return null;
  if (/^\d+$/.test(q)) return User.findOne({ telegramId: Number(q) });
  return User.findOne({ username: new RegExp(`^${q.replace(/^@/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
}

// ---------- step-by-step settings editor ----------
const GROUPS = [...new Set(SETTING_DEFS.map((d) => d.group))];
const optionsOf = (d: SettingDef): string[] => (d.type === 'bool' ? ['true', 'false'] : [...(d.options ?? [])]);
const trunc = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

async function showGroups(ctx: BotContext) {
  await clearState(ctx.dbUser._id);
  const rows = GROUPS.map((g, i) => [Markup.button.callback(`📂 ${g}`, `se:g:${i}`)]);
  rows.push([Markup.button.callback('📢 Required channels', 'fc:home')]);
  rows.push([Markup.button.callback('✖️ Close', 'se:x')]);
  await editOrReply(ctx, '⚙️ <b>Edit settings</b>\n\nChoose a category:', Markup.inlineKeyboard(rows));
}

async function showGroup(ctx: BotContext, gi: number) {
  const group = GROUPS[gi];
  if (!group) return showGroups(ctx);
  await clearState(ctx.dbUser._id);
  const s = await getSettings();
  const rows = SETTING_DEFS.map((d, i) => ({ d, i }))
    .filter(({ d }) => d.group === group)
    .map(({ d, i }) => [Markup.button.callback(trunc(`${d.key}: ${show(d, s[d.key])}`, 60), `se:k:${i}`)]);
  rows.push([Markup.button.callback('⬅️ Categories', 'se:home')]);
  await editOrReply(ctx, `📂 <b>${esc(group)}</b>\n\nTap a setting to change it:`, Markup.inlineKeyboard(rows));
}

async function showKey(ctx: BotContext, idx: number) {
  const d = SETTING_DEFS[idx];
  if (!d) return showGroups(ctx);
  const gi = GROUPS.indexOf(d.group);
  const s = await getSettings();
  const opts = optionsOf(d);
  const lines = [
    `✏️ <b>${esc(d.key)}</b>`,
    esc(d.hint),
    '',
    `Current: <b>${esc(show(d, s[d.key]))}</b>`,
    `Default: ${esc(show(d, SETTING_DEFAULTS[d.key]))}`,
  ];
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  if (opts.length) {
    lines.push('', 'Choose a value:');
    await clearState(ctx.dbUser._id);
    const cur = String(s[d.key]);
    rows.push(opts.map((o, oi) => Markup.button.callback(o === cur ? `✅ ${o}` : o, `se:v:${idx}:${oi}`)));
  } else {
    lines.push('', '👇 <b>Send the new value as a message.</b>', 'Use <code>-</code> to clear it. /cancel to stop.');
    await setState(ctx.dbUser._id, 'awaiting_setting_value', { idx });
  }
  rows.push([Markup.button.callback('♻️ Reset to default', `se:r:${idx}`)]);
  rows.push([Markup.button.callback('⬅️ Back', `se:g:${gi}`)]);
  await editOrReply(ctx, lines.join('\n'), Markup.inlineKeyboard(rows));
}

async function applySetting(ctx: BotContext, idx: number, raw: string): Promise<boolean> {
  const d = SETTING_DEFS[idx];
  if (!d) return false;
  const parsed = parseSettingInput(d, raw);
  if (!parsed.ok) {
    await ctx.reply(`❌ ${parsed.error}\n${d.key}: ${d.hint}\n\nTry again or /cancel.`);
    return false;
  }
  const problem = crossCheck(d.key, parsed.value, await getSettings());
  if (problem) {
    await ctx.reply(`❌ ${problem}\n\nTry again or /cancel.`);
    return false;
  }
  await setSetting(d.key, parsed.value as never);
  return true;
}

/** Called by the text router while the admin is in the "awaiting_setting_value" step. */
export async function handleSettingValueInput(ctx: BotContext, idx: number, text: string) {
  if (!ctx.isAdmin) return ctx.reply('⛔ Admin only.');
  const d = SETTING_DEFS[idx];
  if (d?.secret) await ctx.deleteMessage().catch(() => undefined);
  if (!(await applySetting(ctx, idx, text))) return;
  await clearState(ctx.dbUser._id);
  const s = await getSettings();
  await ctx.reply(`✅ <code>${d.key}</code> saved: <b>${esc(show(d, s[d.key]))}</b>`, HTML);
  await showGroup(ctx, GROUPS.indexOf(d.group));
}

function registerSettingsEditor(bot: Telegraf<BotContext>) {
  bot.command(['settings_edit', 'editsettings', 'settingsedit'], adminOnly, showGroups);
  bot.action('se:home', adminOnly, async (ctx) => {
    await ctx.answerCbQuery();
    await showGroups(ctx);
  });
  bot.action('se:x', adminOnly, async (ctx) => {
    await ctx.answerCbQuery();
    await clearState(ctx.dbUser._id);
    await ctx.editMessageText('Closed.').catch(() => undefined);
  });
  bot.action(/^se:g:(\d+)$/, adminOnly, async (ctx) => {
    await ctx.answerCbQuery();
    await showGroup(ctx, parseInt(ctx.match[1], 10));
  });
  bot.action(/^se:k:(\d+)$/, adminOnly, async (ctx) => {
    await ctx.answerCbQuery();
    await showKey(ctx, parseInt(ctx.match[1], 10));
  });
  bot.action(/^se:v:(\d+):(\d+)$/, adminOnly, async (ctx) => {
    const idx = parseInt(ctx.match[1], 10);
    const d = SETTING_DEFS[idx];
    const value = d ? optionsOf(d)[parseInt(ctx.match[2], 10)] : undefined;
    if (!d || value === undefined) return ctx.answerCbQuery('Unknown option', { show_alert: true });
    if (!(await applySetting(ctx, idx, value))) return ctx.answerCbQuery();
    await ctx.answerCbQuery('Saved ✅');
    await showKey(ctx, idx);
  });
  bot.action(/^se:r:(\d+)$/, adminOnly, async (ctx) => {
    const idx = parseInt(ctx.match[1], 10);
    const d = SETTING_DEFS[idx];
    if (!d) return ctx.answerCbQuery();
    await resetSetting(d.key);
    await ctx.answerCbQuery('Reset to default ♻️');
    await showKey(ctx, idx);
  });
}

export function registerAdminHandlers(bot: Telegraf<BotContext>) {
  bot.command('admin', adminOnly, showPanel);
  registerAdminPanel(bot);
  registerSettingsEditor(bot);

  // ---------- Excel upload ----------
  bot.on('document', async (ctx) => {
    if (!ctx.isAdmin) return ctx.reply('⛔ Only admins can upload files.');
    const doc = ctx.message.document;
    const name = doc.file_name ?? 'upload.xlsx';
    if (!name.toLowerCase().endsWith('.xlsx')) return ctx.reply('❌ Please upload an .xlsx Excel file (Column A = emails).');
    const { maxUploadMb } = await getSettings();
    if ((doc.file_size ?? 0) > maxUploadMb * 1024 * 1024) return ctx.reply(`❌ File too large (max ${maxUploadMb} MB).`);

    const wait = await ctx.reply('⏳ Importing emails…');
    try {
      const link = await ctx.telegram.getFileLink(doc.file_id);
      const res = await axios.get<ArrayBuffer>(link.href, { responseType: 'arraybuffer', timeout: 120_000 });
      const r = await importEmails(Buffer.from(res.data), name, ctx.from.id);
      await ctx.reply(
        [
          `✅ <b>Import finished</b> — ${esc(name)}`,
          '',
          `Rows read: ${r.totalRows}`,
          `➕ New emails added: <b>${r.inserted}</b>`,
          `♻️ Already in database (skipped): ${r.duplicatesInDb}`,
          `👯 Duplicates inside file: ${r.duplicatesInFile}`,
          `🚫 Invalid rows: ${r.invalidRows}`,
        ].join('\n'),
        HTML,
      );
    } catch (e) {
      if (e instanceof AppError) await ctx.reply(`❌ ${e.message}`);
      else {
        logger.error({ err: safeError(e) }, 'Import failed');
        await ctx.reply('❌ Import failed. Check the logs.');
      }
    } finally {
      await ctx.telegram.deleteMessage(wait.chat.id, wait.message_id).catch(() => undefined);
    }
  });

  // ---------- stats / settings ----------
  bot.command('stats', adminOnly, async (ctx) => {
    const [s, st] = await Promise.all([getStats(), getSettings()]);
    await ctx.reply(
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
      HTML,
    );
  });

  bot.command('price', adminOnly, async (ctx) => ctx.reply(`💵 Current price: <b>${fmt((await getSettings()).price)}</b> per email`, HTML));
  bot.command('setprice', adminOnly, async (ctx) => {
    const amt = parseAmount(commandArgs(ctx)[0] ?? '');
    if (!amt) return ctx.reply('Usage: /setprice <amount>   e.g. /setprice 5.50');
    await setSetting('price', amt);
    await ctx.reply(`✅ Price updated to ${fmt(amt)} per email.`);
  });

  bot.command('settings', adminOnly, async (ctx) => {
    const s = await getSettings();
    const lines: string[] = ['⚙️ <b>Settings</b> (stored in database)'];
    let group = '';
    for (const d of SETTING_DEFS) {
      if (d.group !== group) {
        group = d.group;
        lines.push('', `<b>${esc(group)}</b>`);
      }
      lines.push(`<code>${d.key}</code>: ${esc(show(d, s[d.key]))}`);
    }
    lines.push('', 'Change: /set &lt;key&gt; &lt;value&gt;  •  Default: /resetsetting &lt;key&gt;');
    await ctx.reply(lines.join('\n'), HTML);
  });

  bot.command('set', adminOnly, async (ctx) => {
    const [key, ...rest] = commandArgs(ctx);
    const value = rest.join(' ').trim();
    if (!key || !value) return ctx.reply('Usage: /set <key> <value>   (see /settings for the keys)\nUse - as value to clear a text/list setting.');
    const def = findDef(key);
    if (!def) return ctx.reply('Unknown key. Send /settings to see all keys.');

    const parsed = parseSettingInput(def, value);
    // never leave secrets sitting in the chat history
    if (def.secret) await ctx.deleteMessage().catch(() => undefined);
    if (!parsed.ok) return ctx.reply(`❌ ${parsed.error}\n${def.key}: ${def.hint}`);

    const current = await getSettings();
    const problem = crossCheck(def.key, parsed.value, current);
    if (problem) return ctx.reply(`❌ ${problem}`);

    await setSetting(def.key, parsed.value as never);
    await ctx.reply(`✅ <code>${def.key}</code> saved: ${esc(show(def, parsed.value))}`, HTML);
  });

  bot.command('resetsetting', adminOnly, async (ctx) => {
    const def = findDef(commandArgs(ctx)[0]);
    if (!def) return ctx.reply('Usage: /resetsetting <key>   (see /settings for the keys)');
    await resetSetting(def.key);
    await ctx.reply(`♻️ <code>${def.key}</code> reset to default: ${esc(show(def, SETTING_DEFAULTS[def.key]))}`, HTML);
  });

  bot.command('imports', adminOnly, async (ctx) => {
    const list = await ImportBatch.find().sort({ createdAt: -1 }).limit(10).lean();
    if (!list.length) return ctx.reply('No imports yet.');
    await ctx.reply(
      '📥 <b>Recent imports</b>\n\n' +
        list.map((b) => `${fmtDate(b.createdAt)} • ${esc(b.fileName)}\n+${b.inserted} new, ${b.duplicatesInDb} existing, ${b.duplicatesInFile} dup, ${b.invalidRows} invalid`).join('\n\n'),
      HTML,
    );
  });

  // ---------- users ----------
  bot.command('users', adminOnly, async (ctx) => {
    const page = pageArg(commandArgs(ctx));
    const [list, count] = await Promise.all([
      User.find().sort({ createdAt: -1 }).skip((page - 1) * PAGE).limit(PAGE).lean(),
      User.countDocuments(),
    ]);
    const lines = list.map((u) => `${userLabel(u)}${u.isBanned ? ' 🚫' : ''}\nbal ${fmt(u.balance)} • spent ${fmt(u.totalSpent)} • dep ${fmt(u.totalDeposited)}`);
    await ctx.reply(`👥 <b>Users</b> ${count} • page ${page}/${Math.max(1, Math.ceil(count / PAGE))}\n\n${lines.join('\n\n') || '-'}`, HTML);
  });

  bot.command('user', adminOnly, async (ctx) => {
    const u = await findUser(commandArgs(ctx)[0]);
    if (!u) return ctx.reply('User not found. Usage: /user <id|@username>');
    const [orders, deps, ordersCount] = await Promise.all([
      Order.find({ userId: u._id, status: 'completed' }).sort({ createdAt: -1 }).limit(5).lean(),
      Deposit.find({ userId: u._id }).sort({ createdAt: -1 }).limit(5).lean(),
      Order.countDocuments({ userId: u._id, status: 'completed' }),
    ]);
    await ctx.reply(
      [
        `👤 ${userLabel(u)}${u.isBanned ? ' 🚫 BANNED' : ''}`,
        `Joined: ${fmtDate(u.createdAt)}`,
        `Balance: <b>${fmt(u.balance)}</b> • Deposited: ${fmt(u.totalDeposited)} • Spent: ${fmt(u.totalSpent)}`,
        `Orders: ${ordersCount}`,
        '',
        '<b>Last orders</b>',
        ...(orders.map((o) => `#${shortId(o._id)} • ${o.quantity} • ${fmt(o.total)} • ${fmtDate(o.createdAt)}`) || []),
        '',
        '<b>Last deposits</b>',
        ...(deps.map((d) => `${d.status} • ${d.method} • <code>${esc(d.trxId)}</code> • ${fmt(d.verifiedAmount ?? d.claimedAmount)}`) || []),
      ].join('\n'),
      HTML,
    );
  });

  const adjust = (sign: 1 | -1) => async (ctx: BotContext) => {
    const [who, amtRaw, ...note] = commandArgs(ctx);
    if (!who) return showUserPicker(ctx); // no arguments: guided flow (pick user → credit/debit → amount)
    const amt = parseAmount(amtRaw ?? '');
    const u = await findUser(who);
    if (!u || !amt) return ctx.reply(`Usage: /${sign === 1 ? 'addbalance' : 'deductbalance'} <id|@user> <amount> [note]`);
    const op = {
      userId: u._id,
      amount: amt,
      opKey: newOpKey('admin'),
      type: sign === 1 ? ('admin_credit' as const) : ('admin_debit' as const),
      note: `admin ${ctx.from!.id}${note.length ? `: ${note.join(' ')}` : ''}`,
    };
    const r = sign === 1 ? await creditWallet(op) : await debitWallet(op);
    if (!r.ok) return ctx.reply(r.reason === 'insufficient' ? '❌ User balance is lower than that amount.' : '❌ Failed.');
    await ctx.reply(`✅ Done. ${userLabel(u)} new balance: <b>${fmt(r.balanceAfter ?? 0)}</b>`, HTML);
    await ctx.telegram
      .sendMessage(u.telegramId, `💰 Your wallet was ${sign === 1 ? 'credited' : 'debited'} ${fmt(amt)} by admin.\nNew balance: ${fmt(r.balanceAfter ?? 0)}`)
      .catch(() => undefined);
  };
  bot.command('addbalance', adminOnly, adjust(1));
  bot.command('deductbalance', adminOnly, adjust(-1));

  const ban = (value: boolean) => async (ctx: BotContext) => {
    const u = await findUser(commandArgs(ctx)[0]);
    if (!u) return ctx.reply('User not found.');
    if (env.ADMIN_IDS.includes(u.telegramId)) return ctx.reply('You cannot ban an admin.');
    await User.updateOne({ _id: u._id }, { isBanned: value });
    await ctx.telegram
      .sendMessage(u.telegramId, value ? '🚫 Your account has been suspended.' : '✅ Your account has been restored. You can use the bot again.')
      .catch(() => undefined);
    await ctx.reply(`${value ? '🚫 Banned' : '✅ Unbanned'}: ${userLabel(u)}`, HTML);
  };
  bot.command('ban', adminOnly, ban(true));
  bot.command('unban', adminOnly, ban(false));

  // ---------- global history ----------
  bot.command('allorders', adminOnly, async (ctx) => {
    const page = pageArg(commandArgs(ctx));
    const [list, count] = await Promise.all([
      Order.find().sort({ createdAt: -1 }).skip((page - 1) * PAGE).limit(PAGE).lean(),
      Order.countDocuments(),
    ]);
    const lines = list.map((o) => `#${shortId(o._id)} • <code>${o.telegramId}</code> • ${o.quantity} × ${fmt(o.unitPrice)} = <b>${fmt(o.total)}</b> • ${o.status}\n${fmtDate(o.createdAt)}`);
    await ctx.reply(`🛍 <b>Orders</b> ${count} • page ${page}\n\n${lines.join('\n\n') || '-'}`, HTML);
  });

  bot.command('alldeposits', adminOnly, async (ctx) => {
    const page = pageArg(commandArgs(ctx));
    const [list, count] = await Promise.all([
      Deposit.find().sort({ createdAt: -1 }).skip((page - 1) * PAGE).limit(PAGE).lean(),
      Deposit.countDocuments(),
    ]);
    const lines = list.map(
      (d) => `${d.status} • ${d.method} • <code>${d.telegramId}</code> • <code>${esc(d.trxId)}</code> • ${fmt(d.verifiedAmount ?? d.claimedAmount)}${d.failReason ? `\n<i>${esc(d.failReason.slice(0, 80))}</i>` : ''}\n${fmtDate(d.createdAt)}`,
    );
    await ctx.reply(`📥 <b>Deposits</b> ${count} • page ${page}\n\n${lines.join('\n\n') || '-'}`, HTML);
  });

  bot.command('alltx', adminOnly, async (ctx) => {
    const page = pageArg(commandArgs(ctx));
    const [list, count] = await Promise.all([
      Transaction.find().sort({ createdAt: -1 }).skip((page - 1) * PAGE).limit(PAGE).lean(),
      Transaction.countDocuments(),
    ]);
    const lines = list.map((t) => `<code>${t.telegramId}</code> • ${t.type} • <b>${fmtSigned(t.amount)}</b> • bal ${fmt(t.balanceAfter)}\n${fmtDate(t.createdAt)}`);
    await ctx.reply(`🧾 <b>Transactions</b> ${count} • page ${page}\n\n${lines.join('\n\n') || '-'}`, HTML);
  });
}
