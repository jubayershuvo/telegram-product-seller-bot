"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.privateOnly = exports.adminOnly = exports.loadUser = void 0;
const User_1 = require("../../models/User");
const env_1 = require("../../config/env");
const errors_1 = require("../../utils/errors");
/** Registers/refreshes the user on every update and blocks banned users. */
const loadUser = async (ctx, next) => {
    const from = ctx.from;
    if (!from || from.is_bot)
        return;
    const update = {
        $set: { username: from.username, firstName: from.first_name, lastName: from.last_name, lastSeenAt: new Date(), botBlocked: false },
    };
    let user;
    try {
        user = await User_1.User.findOneAndUpdate({ telegramId: from.id }, update, { upsert: true, new: true, setDefaultsOnInsert: true });
    }
    catch (e) {
        if (!(0, errors_1.isDuplicateKeyError)(e))
            throw e;
        user = await User_1.User.findOneAndUpdate({ telegramId: from.id }, update, { new: true });
    }
    if (!user)
        return;
    ctx.dbUser = user;
    ctx.isAdmin = env_1.env.ADMIN_IDS.includes(from.id);
    if (user.isBanned && !ctx.isAdmin) {
        if (ctx.callbackQuery)
            await ctx.answerCbQuery('You are banned.', { show_alert: true }).catch(() => undefined);
        else
            await ctx.reply('🚫 Your account has been suspended.').catch(() => undefined);
        return;
    }
    return next();
};
exports.loadUser = loadUser;
const adminOnly = async (ctx, next) => {
    if (!ctx.isAdmin) {
        if (ctx.callbackQuery)
            await ctx.answerCbQuery('Admin only', { show_alert: true }).catch(() => undefined);
        else
            await ctx.reply('⛔ Admin only.').catch(() => undefined);
        return;
    }
    return next();
};
exports.adminOnly = adminOnly;
const privateOnly = async (ctx, next) => {
    if (ctx.chat && ctx.chat.type !== 'private')
        return;
    return next();
};
exports.privateOnly = privateOnly;
//# sourceMappingURL=auth.js.map