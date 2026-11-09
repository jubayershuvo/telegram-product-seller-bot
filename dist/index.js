"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const env_1 = require("./config/env");
const db_1 = require("./config/db");
const bot_1 = require("./bot");
const recovery_1 = require("./services/recovery");
const migrateLegacy_1 = require("./services/migrateLegacy");
const settings_1 = require("./services/settings");
const logger_1 = require("./utils/logger");
const errors_1 = require("./utils/errors");
async function main() {
    await (0, db_1.connectDb)();
    await (0, settings_1.seedDefaults)(); // inserts any missing setting with its default from models/Setting.ts
    await (0, migrateLegacy_1.migrateLegacyEmails)(); // one-time: old single-product `emails` -> product "Emails"
    const settingsTimer = setInterval(() => void (0, settings_1.loadSettings)().catch(() => undefined), 30_000);
    settingsTimer.unref();
    const bot = (0, bot_1.createBot)();
    const me = await bot.telegram.getMe();
    logger_1.logger.info({ bot: `@${me.username}`, mode: env_1.env.BOT_MODE }, 'Bot authenticated');
    if (!process.env.SMSSYNC_API_KEY) {
        logger_1.logger.warn('SMSSYNC_API_KEY is empty: recharges will fail until you set it in .env');
    }
    await (0, recovery_1.recoverStale)();
    const timer = setInterval(recovery_1.recoverStale, 5 * 60_000);
    timer.unref();
    await (0, bot_1.registerCommandMenus)(bot);
    const stop = async (signal) => {
        logger_1.logger.info({ signal }, 'Shutting down');
        clearInterval(timer);
        clearInterval(settingsTimer);
        try {
            bot.stop(signal);
        }
        catch {
            /* not running */
        }
        await (0, db_1.disconnectDb)().catch(() => undefined);
        process.exit(0);
    };
    process.once('SIGINT', () => void stop('SIGINT'));
    process.once('SIGTERM', () => void stop('SIGTERM'));
    if (env_1.env.BOT_MODE === 'webhook') {
        await bot.launch({
            webhook: { domain: env_1.env.WEBHOOK_DOMAIN, hookPath: env_1.env.WEBHOOK_PATH, port: env_1.env.PORT, secretToken: env_1.env.WEBHOOK_SECRET },
        });
        logger_1.logger.info({ port: env_1.env.PORT }, 'Webhook server started');
    }
    else {
        await bot.telegram.deleteWebhook({ drop_pending_updates: false });
        void bot
            .launch(() => logger_1.logger.info('Bot started (long polling)'))
            .catch((e) => {
            logger_1.logger.fatal({ err: (0, errors_1.safeError)(e) }, 'Bot stopped unexpectedly');
            process.exit(1);
        });
    }
}
process.on('unhandledRejection', (e) => logger_1.logger.error({ err: (0, errors_1.safeError)(e) }, 'unhandledRejection'));
process.on('uncaughtException', (e) => {
    logger_1.logger.fatal({ err: (0, errors_1.safeError)(e) }, 'uncaughtException');
    process.exit(1);
});
main().catch((e) => {
    logger_1.logger.fatal({ err: (0, errors_1.safeError)(e) }, 'Startup failed');
    process.exit(1);
});
//# sourceMappingURL=index.js.map