"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.forceSub = void 0;
const settings_1 = require("../../services/settings");
const channels_1 = require("../../services/channels");
const channelGate_1 = require("../channelGate");
const shop_1 = require("../handlers/shop");
const ui_1 = require("../ui");
/**
 * Force channel subscription. Runs after loadUser, so every user is stored in MongoDB
 * (and can be broadcast to) even before they join.
 * Membership is re-verified with getChatMember on every update (10 s burst cache).
 */
const forceSub = async (ctx, next) => {
    if (ctx.isAdmin || !ctx.from)
        return next();
    const settings = await (0, settings_1.getSettings)();
    if (!settings.forceJoinEnabled)
        return next();
    const channels = await (0, channels_1.listChannels)();
    if (!channels.length)
        return next();
    const isCheck = !!ctx.callbackQuery && 'data' in ctx.callbackQuery && ctx.callbackQuery.data === 'fs:check';
    const missing = await (0, channels_1.findMissingChannels)(ctx.telegram, ctx.from.id, channels, { force: isCheck });
    if (!missing.length) {
        if (!isCheck)
            return next();
        await ctx.answerCbQuery('✅ Verified, welcome!').catch(() => undefined);
        await ctx.deleteMessage().catch(() => undefined);
        return (0, shop_1.showWelcome)(ctx);
    }
    const gate = (0, channelGate_1.buildGate)(missing);
    if (isCheck) {
        await ctx.answerCbQuery('❌ You have not joined all channels yet.', { show_alert: true }).catch(() => undefined);
        // refresh the list so it only shows what is still missing (ignore "message is not modified")
        await ctx.editMessageText(gate.text, { ...ui_1.HTML, ...gate.keyboard }).catch(() => undefined);
        return;
    }
    if (ctx.callbackQuery) {
        await ctx.answerCbQuery('🔒 Join the required channels first, then use /start', { show_alert: true }).catch(() => undefined);
        return;
    }
    await ctx.reply(gate.text, { ...ui_1.HTML, ...gate.keyboard, link_preview_options: { is_disabled: true } }).catch(() => undefined);
};
exports.forceSub = forceSub;
//# sourceMappingURL=forceSub.js.map