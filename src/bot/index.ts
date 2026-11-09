import { Telegraf } from 'telegraf';
import { env } from '../config/env';
import { BotContext } from './context';
import { loadUser, privateOnly } from './middlewares/auth';
import { rateLimit } from './middlewares/rateLimit';
import { forceSub } from './middlewares/forceSub';
import { registerChannelHandlers } from './handlers/channels';
import { registerBroadcastHandlers } from './handlers/broadcast';
import { registerShopHandlers } from './handlers/shop';
import { registerRechargeHandlers } from './handlers/recharge';
import { registerAdminHandlers } from './handlers/admin';
import { registerTextRouter } from './handlers/text';
import { logger } from '../utils/logger';
import { safeError } from '../utils/errors';

function noLinkPreview<T extends object>(tg: T): T {
  const t = tg as any;
  if (t.__noPreview) return tg;
  const orig = t.callApi.bind(t);
  t.callApi = (method: string, payload: any, ...rest: any[]) => {
    if (
      (method === 'sendMessage' || method === 'editMessageText') &&
      payload &&
      payload.link_preview_options === undefined &&
      payload.disable_web_page_preview === undefined
    ) {
      payload = { ...payload, link_preview_options: { is_disabled: true } };
    }
    return orig(method, payload, ...rest);
  };
  t.__noPreview = true;
  return tg;
}

export function createBot(): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(env.BOT_TOKEN, { handlerTimeout: 300_000 });

  // Never show link previews (embeds) in any text message.
  // Telegraf creates a NEW Telegram client for every update (ctx.telegram), so patching bot.telegram alone is not enough:
  // patch it once for the bot (broadcasts, notifications) and again for every incoming update.
  noLinkPreview(bot.telegram);
  bot.use((ctx, next) => {
    noLinkPreview(ctx.telegram);
    return next();
  });

  bot.use(privateOnly);
  bot.use(rateLimit);
  bot.use(loadUser);
  bot.use(forceSub); // users must have joined every required channel (admins are exempt)

  // order matters: specific handlers first, generic text router last
  // these two listen for the admin's next message (forwarded channel post / broadcast content), so they go first
  registerChannelHandlers(bot);
  registerBroadcastHandlers(bot);
  registerAdminHandlers(bot);
  registerShopHandlers(bot);
  registerRechargeHandlers(bot);
  registerTextRouter(bot);

  bot.catch(async (err, ctx) => {
    logger.error({ err: safeError(err), update: ctx.update.update_id }, 'Unhandled bot error');
    await ctx.reply('⚠️ Something went wrong. Please try again.').catch(() => undefined);
  });
  return bot;
}

export async function registerCommandMenus(bot: Telegraf<BotContext>): Promise<void> {
  await bot.telegram
    .setMyCommands([
      { command: 'start', description: 'Start / main menu' },
      { command: 'balance', description: 'Wallet balance' },
      { command: 'buy', description: 'Browse products & buy' },
      { command: 'recharge', description: 'Add money to wallet' },
      { command: 'orders', description: 'Purchase history' },
      { command: 'transactions', description: 'Wallet transactions' },
      { command: 'deposits', description: 'Recharge history' },
      { command: 'help', description: 'Help' },
    ])
    .catch(() => undefined);
  for (const id of env.ADMIN_IDS) {
    await bot.telegram
      .setMyCommands(
        [
          { command: 'admin', description: 'Admin command list' },
          { command: 'products', description: 'Manage products & upload stock' },
          { command: 'newproduct', description: 'Create a product' },
          { command: 'stats', description: 'Inventory & sales stats' },
          { command: 'recharge_on', description: 'Open recharge for all' },
          { command: 'recharge_off', description: 'Close recharge for all' },
          { command: 'recharge_hours', description: 'Daily recharge hours' },
          { command: 'ban', description: 'Ban user: /ban <id|@user>' },
          { command: 'unban', description: 'Unban user: /unban <id|@user>' },
          { command: 'banned', description: 'Banned users' },
          { command: 'broadcast', description: 'Send a message to all users' },
          { command: 'channels', description: 'Required channels (force join)' },
          { command: 'addchannel', description: 'Add required channel' },
          { command: 'removechannel', description: 'Remove required channel' },
          { command: 'settings_edit', description: 'Edit settings step by step' },
          { command: 'settings', description: 'Show all settings' },
          { command: 'price', description: 'Default price for new products' },
          { command: 'users', description: 'List users' },
          { command: 'allorders', description: 'All orders' },
          { command: 'alldeposits', description: 'All deposits' },
          { command: 'alltx', description: 'All transactions' },
          { command: 'balance', description: 'My wallet' },
          { command: 'buy', description: 'Browse products & buy' },
        ],
        { scope: { type: 'chat', chat_id: id } },
      )
      .catch(() => undefined);
  }
}
