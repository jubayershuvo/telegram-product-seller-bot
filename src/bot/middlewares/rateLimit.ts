import { Middleware } from 'telegraf';
import { BotContext } from '../context';

const WINDOW_MS = 10_000;
const MAX_HITS = 25;
const hits = new Map<number, { count: number; resetAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
}, 60_000).unref();

/** Simple per-user flood protection. */
export const rateLimit: Middleware<BotContext> = async (ctx, next) => {
  const id = ctx.from?.id;
  if (!id) return next();
  const now = Date.now();
  const h = hits.get(id);
  if (!h || h.resetAt < now) {
    hits.set(id, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }
  h.count++;
  if (h.count > MAX_HITS) {
    if (h.count === MAX_HITS + 1 && ctx.chat) await ctx.reply('⚠️ Slow down, too many requests.').catch(() => undefined);
    return;
  }
  return next();
};
