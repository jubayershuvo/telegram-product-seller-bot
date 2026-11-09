"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBot = createBot;
exports.registerCommandMenus = registerCommandMenus;
const telegraf_1 = require("telegraf");
const env_1 = require("../config/env");
const auth_1 = require("./middlewares/auth");
const rateLimit_1 = require("./middlewares/rateLimit");
const forceSub_1 = require("./middlewares/forceSub");
const channels_1 = require("./handlers/channels");
const broadcast_1 = require("./handlers/broadcast");
const shop_1 = require("./handlers/shop");
const recharge_1 = require("./handlers/recharge");
const admin_1 = require("./handlers/admin");
const text_1 = require("./handlers/text");
const logger_1 = require("../utils/logger");
const errors_1 = require("../utils/errors");
function createBot() {
    const bot = new telegraf_1.Telegraf(env_1.env.BOT_TOKEN, { handlerTimeout: 120_000 });
    bot.use(auth_1.privateOnly);
    bot.use(rateLimit_1.rateLimit);
    bot.use(auth_1.loadUser);
    bot.use(forceSub_1.forceSub); // users must have joined every required channel (admins are exempt)
    // order matters: specific handlers first, generic text router last
    // these two listen for the admin's next message (forwarded channel post / broadcast content), so they go first
    (0, channels_1.registerChannelHandlers)(bot);
    (0, broadcast_1.registerBroadcastHandlers)(bot);
    (0, admin_1.registerAdminHandlers)(bot);
    (0, shop_1.registerShopHandlers)(bot);
    (0, recharge_1.registerRechargeHandlers)(bot);
    (0, text_1.registerTextRouter)(bot);
    bot.catch(async (err, ctx) => {
        logger_1.logger.error({ err: (0, errors_1.safeError)(err), update: ctx.update.update_id }, 'Unhandled bot error');
        await ctx.reply('⚠️ Something went wrong. Please try again.').catch(() => undefined);
    });
    return bot;
}
async function registerCommandMenus(bot) {
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
    for (const id of env_1.env.ADMIN_IDS) {
        await bot.telegram
            .setMyCommands([
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
        ], { scope: { type: 'chat', chat_id: id } })
            .catch(() => undefined);
    }
}
//# sourceMappingURL=index.js.map