import { Middleware } from 'telegraf';
import { BotContext } from '../context';
import { User } from '../../models/User';
import { env } from '../../config/env';
import { isDuplicateKeyError } from '../../utils/errors';

/** Registers/refreshes the user on every update and blocks banned users. */
export const loadUser: Middleware<BotContext> = async (ctx, next) => {
  const from = ctx.from;
  if (!from || from.is_bot) return;

  const update = {
    $set: { username: from.username, firstName: from.first_name, lastName: from.last_name, lastSeenAt: new Date(), botBlocked: false },
  };
  let user;
  try {
    user = await User.findOneAndUpdate({ telegramId: from.id }, update, { upsert: true, new: true, setDefaultsOnInsert: true });
  } catch (e) {
    if (!isDuplicateKeyError(e)) throw e;
    user = await User.findOneAndUpdate({ telegramId: from.id }, update, { new: true });
  }
  if (!user) return;

  ctx.dbUser = user;
  ctx.isAdmin = env.ADMIN_IDS.includes(from.id);

  if (user.isBanned && !ctx.isAdmin) {
    if (ctx.callbackQuery) await ctx.answerCbQuery('You are banned.', { show_alert: true }).catch(() => undefined);
    else await ctx.reply('🚫 Your account has been suspended.').catch(() => undefined);
    return;
  }
  return next();
};

export const adminOnly: Middleware<BotContext> = async (ctx, next) => {
  if (!ctx.isAdmin) {
    if (ctx.callbackQuery) await ctx.answerCbQuery('Admin only', { show_alert: true }).catch(() => undefined);
    else await ctx.reply('⛔ Admin only.').catch(() => undefined);
    return;
  }
  return next();
};

export const privateOnly: Middleware<BotContext> = async (ctx, next) => {
  if (ctx.chat && ctx.chat.type !== 'private') return;
  return next();
};
