import { Markup } from 'telegraf';
import { BotContext } from './context';
import { User } from '../models/User';
import { Types } from 'mongoose';

export const HTML = { parse_mode: 'HTML' as const };

export const esc = (s: string | number | undefined | null): string =>
  String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

export const BTN = {
  balance: '💰 Balance',
  buy: '🛒 Buy',
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
