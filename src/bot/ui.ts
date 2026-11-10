import { Markup } from 'telegraf';
import { BotContext } from './context';
import { User } from '../models/User';
import { Types } from 'mongoose';
import { getCachedSettings } from '../services/settings';
import { SETTING_DEFAULTS } from '../models/Setting';

export const HTML = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true } };

export const esc = (s: string | number | undefined | null): string =>
  String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

/** Shop name from settings, HTML-escaped, ready to drop into a message. */
export const shopName = (): string => esc(getCachedSettings().shopName?.trim() || SETTING_DEFAULTS.shopName);

/** Shop logo emoji from settings, HTML-escaped. Empty string = admin removed the logo. */
export const shopLogo = (): string => {
  const logo = getCachedSettings().shopLogo;
  return esc(typeof logo === 'string' ? logo.trim() : SETTING_DEFAULTS.shopLogo);
};

/** "🏪 Digital Store" - logo + shop name, the header used on every screen. */
export const shopTitle = (): string => [shopLogo(), shopName()].filter(Boolean).join(' ');

export const LINE = '━━━━━━━━━━━━━━';
export const trunc = (t: string, n: number): string => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** "✅ 120 in stock" / "⚠️ Only 3 left" / "❌ Sold out" */
export const stockLabel = (n: number): string => (n <= 0 ? '❌ Sold out' : n <= 10 ? `⚠️ Only ${n} left` : `✅ ${n} in stock`);

export const BTN = {
  balance: '💰 Balance',
  buy: '🛍 Shop',
  recharge: '➕ Recharge',
  orders: '📦 My Orders',
  tx: '🧾 Transactions',
  help: 'ℹ️ Help',
  admin: '🛠 Admin Panel',
};

export const mainMenu = (isAdmin = false) => {
  const rows = [[BTN.balance, BTN.buy], [BTN.recharge, BTN.orders], [BTN.tx, BTN.help]];
  if (isAdmin) rows.push([BTN.admin]);
  return Markup.keyboard(rows).resize();
};

export async function editOrReply(ctx: BotContext, text: string, extra: object = {}): Promise<void> {
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, { ...HTML, ...extra } as any);
      return;
    } catch {
      /* message not modified / too old: fall through to a new message */
    }
  }
  await ctx.reply(text, { ...HTML, ...extra } as any);
}

export function commandArgs(ctx: BotContext): string[] {
  const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') || '';
  return text.trim().split(/\s+/).slice(1);
}

export function userLabel(u: { telegramId: number; username?: string; firstName?: string }): string {
  const name = esc(u.firstName || 'User');
  const at = u.username ? ` @${esc(u.username)}` : '';
  return `${name}${at} (<code>${u.telegramId}</code>)`;
}

export async function setState(userId: Types.ObjectId, name: string, data: Record<string, unknown> = {}): Promise<void> {
  await User.updateOne({ _id: userId }, { $set: { state: { name, data, at: new Date() } } });
}

export async function clearState(userId: Types.ObjectId): Promise<void> {
  await User.updateOne({ _id: userId }, { $unset: { state: 1 } });
}

export const shortId = (id: unknown) => String(id).slice(-6).toUpperCase();
