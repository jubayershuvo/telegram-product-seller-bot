import { Middleware } from 'telegraf';
import { BotContext } from '../context';
import { getSettings } from '../../services/settings';
import { findMissingChannels, listChannels } from '../../services/channels';
import { buildGate } from '../channelGate';
import { showWelcome } from '../handlers/shop';
import { HTML } from '../ui';

/**
 * Force channel subscription. Runs after loadUser, so every user is stored in MongoDB
 * (and can be broadcast to) even before they join.
 * Membership is re-verified with getChatMember on every update (10 s burst cache).
 */
export const forceSub: Middleware<BotContext> = async (ctx, next) => {
  if (ctx.isAdmin || !ctx.from) return next();

  const settings = await getSettings();
  if (!settings.forceJoinEnabled) return next();
  const channels = await listChannels();
  if (!channels.length) return next();

  const isCheck = !!ctx.callbackQuery && 'data' in ctx.callbackQuery && ctx.callbackQuery.data === 'fs:check';
  const missing = await findMissingChannels(ctx.telegram, ctx.from.id, channels, { force: isCheck });

  if (!missing.length) {
    if (!isCheck) return next();
    await ctx.answerCbQuery('✅ Verified, welcome!').catch(() => undefined);
    await ctx.deleteMessage().catch(() => undefined);
    return showWelcome(ctx);
  }

  const gate = buildGate(missing);
  if (isCheck) {
    await ctx.answerCbQuery('❌ You have not joined all channels yet.', { show_alert: true }).catch(() => undefined);
    // refresh the list so it only shows what is still missing (ignore "message is not modified")
    await ctx.editMessageText(gate.text, { ...HTML, ...gate.keyboard }).catch(() => undefined);
    return;
  }
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery('🔒 Join the required channels first, then use /start', { show_alert: true }).catch(() => undefined);
    return;
  }
  await ctx.reply(gate.text, { ...HTML, ...gate.keyboard, link_preview_options: { is_disabled: true } } as any).catch(() => undefined);
};
