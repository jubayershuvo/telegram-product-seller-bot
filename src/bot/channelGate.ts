import { Markup } from 'telegraf';
import type { InlineKeyboardButton } from 'telegraf/types';
import { ChannelLean, joinUrl } from '../services/channels';
import { esc } from './ui';

const trunc = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** Text + keyboard shown to a user who has not joined every required channel. */
export function buildGate(missing: ChannelLean[]) {
  const text = [
    '🔒 <b>Join required</b>',
    '',
    'To use this bot you must join the channel(s) below first:',
    ...missing.map((c) => `• ${esc(c.title)}${c.username ? ` (@${esc(c.username)})` : ''}`),
    '',
    'After joining, tap <b>✅ I\'ve Joined</b>.',
  ].join('\n');

  const rows: InlineKeyboardButton[][] = missing.flatMap((c) => {
    const url = joinUrl(c);
    return url ? [[Markup.button.url(`📢 Join ${trunc(c.title, 40)}`, url)]] : [];
  });
  rows.push([Markup.button.callback("✅ I've Joined", 'fs:check')]);
  return { text, keyboard: Markup.inlineKeyboard(rows) };
}
