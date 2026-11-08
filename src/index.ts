import { env } from './config/env';
import { connectDb, disconnectDb } from './config/db';
import { createBot, registerCommandMenus } from './bot';
import { recoverStale } from './services/recovery';
import { seedDefaults, loadSettings } from './services/settings';
import { logger } from './utils/logger';
import { safeError } from './utils/errors';

async function main() {
  await connectDb();
  await seedDefaults(); // inserts any missing setting with its default from models/Setting.ts
  const settingsTimer = setInterval(() => void loadSettings().catch(() => undefined), 30_000);
  settingsTimer.unref();
  const bot = createBot();

  const me = await bot.telegram.getMe();
  logger.info({ bot: `@${me.username}`, mode: env.BOT_MODE }, 'Bot authenticated');
  if (!process.env.SMSSYNC_API_KEY) {
    logger.warn('SMSSYNC_API_KEY is empty: recharges will fail until you set it in .env');
  }

  await recoverStale();
  const timer = setInterval(recoverStale, 5 * 60_000);
  timer.unref();

  await registerCommandMenus(bot);

  const stop = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    clearInterval(timer);
    clearInterval(settingsTimer);
    try {
      bot.stop(signal);
    } catch {
      /* not running */
    }
    await disconnectDb().catch(() => undefined);
    process.exit(0);
  };
  process.once('SIGINT', () => void stop('SIGINT'));
  process.once('SIGTERM', () => void stop('SIGTERM'));

  if (env.BOT_MODE === 'webhook') {
    await bot.launch({
      webhook: { domain: env.WEBHOOK_DOMAIN!, hookPath: env.WEBHOOK_PATH, port: env.PORT, secretToken: env.WEBHOOK_SECRET },
    });
    logger.info({ port: env.PORT }, 'Webhook server started');
  } else {
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
    void bot
      .launch(() => logger.info('Bot started (long polling)'))
      .catch((e) => {
        logger.fatal({ err: safeError(e) }, 'Bot stopped unexpectedly');
        process.exit(1);
      });
  }
}

process.on('unhandledRejection', (e) => logger.error({ err: safeError(e) }, 'unhandledRejection'));
process.on('uncaughtException', (e) => {
  logger.fatal({ err: safeError(e) }, 'uncaughtException');
  process.exit(1);
});

main().catch((e) => {
  logger.fatal({ err: safeError(e) }, 'Startup failed');
  process.exit(1);
});
