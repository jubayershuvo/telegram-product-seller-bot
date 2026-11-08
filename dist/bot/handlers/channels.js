"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.showChannels = showChannels;
exports.handleChannelInput = handleChannelInput;
exports.registerChannelHandlers = registerChannelHandlers;
const telegraf_1 = require("telegraf");
const ui_1 = require("../ui");
const auth_1 = require("../middlewares/auth");
const settings_1 = require("../../services/settings");
const channels_1 = require("../../services/channels");
const errors_1 = require("../../utils/errors");
const logger_1 = require("../../utils/logger");
const cb = telegraf_1.Markup.button.callback;
const trunc = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const STATE_TTL_MS = 30 * 60_000;
const kindLabel = (c) => (c.username ? `@${c.username}` : 'private');
// =====================================================================
//  Screens (reachable from Settings → "Required channels" and /channels)
// =====================================================================
async function showChannels(ctx, notice) {
    await (0, ui_1.clearState)(ctx.dbUser._id);
    const [list, s] = await Promise.all([(0, channels_1.listChannels)(), (0, settings_1.getSettings)()]);
    const lines = [
        '📢 <b>Required channels</b>',
        notice ?? '',
        `Force join: ${s.forceJoinEnabled ? '🟢 <b>ON</b>' : '🔴 <b>OFF</b>'}${s.forceJoinEnabled && !list.length ? ' (no channel added yet, so nobody is blocked)' : ''}`,
        '',
        list.length ? list.map((c, i) => `${i + 1}. ${(0, ui_1.esc)(c.title)} • ${(0, ui_1.esc)(kindLabel(c))} • <code>${c.chatId}</code>`).join('\n') : 'No channels added yet.',
        '',
        'Tap a channel to remove it, or add a new one.',
    ].filter((l, i) => i !== 1 || l !== '');
    const rows = list.map((c) => [cb(`🗑 ${trunc(c.title, 28)} (${kindLabel(c)})`, `fc:d:${c.chatId}`)]);
    rows.push([cb('➕ Add channel', 'fc:add')]);
    rows.push([cb(s.forceJoinEnabled ? '🔴 Turn force join OFF' : '🟢 Turn force join ON', 'fc:t')]);
    rows.push([cb('⬅️ Settings', 'se:home')]);
    await (0, ui_1.editOrReply)(ctx, lines.join('\n'), telegraf_1.Markup.inlineKeyboard(rows));
}
async function askChannel(ctx) {
    await (0, ui_1.setState)(ctx.dbUser._id, 'awaiting_channel');
    await (0, ui_1.editOrReply)(ctx, [
        '➕ <b>Add required channel</b>',
        '',
        'First add this bot as an <b>administrator</b> of the channel (needed to read the member list).',
        '',
        'Then send one of:',
        '• <b>Public:</b> <code>@channelusername</code> or <code>https://t.me/channelusername</code>',
        '• <b>Private:</b> the numeric ID, e.g. <code>-1001234567890</code>, optionally followed by an invite link:',
        '   <code>-1001234567890 https://t.me/+AbCdEf</code>',
        '• or simply <b>forward any message</b> from the channel to me.',
        '',
        'For private channels without a link, I create one myself if I have the "Invite users" right.',
        '/cancel to stop.',
    ].join('\n'), telegraf_1.Markup.inlineKeyboard([[cb('⬅️ Back', 'fc:home')]]));
}
async function saveChannel(ctx, ref, invite) {
    try {
        const chat = await (0, channels_1.resolveChat)(ctx.telegram, ref);
        const { channel, created } = await (0, channels_1.addChannel)(ctx.telegram, ctx.from.id, { chat, inviteLink: invite });
        await (0, ui_1.clearState)(ctx.dbUser._id);
        await ctx.reply(`✅ ${created ? 'Added' : 'Updated'}: <b>${(0, ui_1.esc)(channel.title)}</b> (${(0, ui_1.esc)(kindLabel(channel))})`, ui_1.HTML);
        await showChannels(ctx);
        return true;
    }
    catch (e) {
        if (e instanceof errors_1.AppError)
            await ctx.reply(`❌ ${e.message}\n\nTry again or /cancel.`, ui_1.HTML);
        else {
            logger_1.logger.error({ err: (0, errors_1.safeError)(e) }, 'Add channel failed');
            await ctx.reply('❌ Could not add that channel. Check the logs.');
        }
        return false;
    }
}
/** Called by the text router while the admin is in the "awaiting_channel" step. */
async function handleChannelInput(ctx, text) {
    if (!ctx.isAdmin)
        return ctx.reply('⛔ Admin only.');
    const { ref, invite } = (0, channels_1.splitChannelInput)(text.split(/\s+/));
    if (!ref)
        return ctx.reply('❌ Send @username, a t.me link or the numeric ID. /cancel to stop.');
    await saveChannel(ctx, ref, invite);
}
// =====================================================================
//  Registration
// =====================================================================
function registerChannelHandlers(bot) {
    // forwarded message from a channel while "Add channel" is waiting for input (works for private channels too)
    bot.on('message', async (ctx, next) => {
        const st = ctx.dbUser?.state;
        const waiting = ctx.isAdmin && st?.name === 'awaiting_channel' && st.at && Date.now() - new Date(st.at).getTime() < STATE_TTL_MS;
        if (!waiting)
            return next();
        const m = ctx.message;
        const origin = m.forward_origin?.type === 'channel' ? m.forward_origin.chat : m.forward_from_chat;
        if (!origin)
            return next(); // normal text goes on to the text router
        await saveChannel(ctx, origin.id);
    });
    bot.command(['channels', 'channel_list'], auth_1.adminOnly, (ctx) => showChannels(ctx));
    // /addchannel @username   |   /addchannel -1001234567890 [https://t.me/+invite]
    bot.command('addchannel', auth_1.adminOnly, async (ctx) => {
        const { ref, invite } = (0, channels_1.splitChannelInput)((0, ui_1.commandArgs)(ctx));
        if (!ref)
            return ctx.reply('Usage:\n/addchannel @username\n/addchannel -1001234567890 https://t.me/+invite\n\nOr use Settings → Required channels (you can also forward a message from the channel there).');
        await saveChannel(ctx, ref, invite);
    });
    bot.command(['removechannel', 'delchannel'], auth_1.adminOnly, async (ctx) => {
        const ref = (0, ui_1.commandArgs)(ctx)[0];
        if (!ref)
            return ctx.reply('Usage: /removechannel <@username|channel id>');
        const gone = await (0, channels_1.removeChannel)(ref);
        await ctx.reply(gone ? `🗑 Removed: ${gone.title}` : 'Channel not found. See /channels.');
    });
    bot.command('forcejoin', auth_1.adminOnly, async (ctx) => {
        const a = ((0, ui_1.commandArgs)(ctx)[0] ?? '').toLowerCase();
        if (!['on', 'off'].includes(a))
            return ctx.reply(`Force join is ${(await (0, settings_1.getSettings)()).forceJoinEnabled ? 'ON' : 'OFF'}.\nUsage: /forcejoin on|off`);
        await (0, settings_1.setSetting)('forceJoinEnabled', a === 'on');
        await ctx.reply(`Force join turned ${a.toUpperCase()}.`);
    });
    // ----- buttons -----
    bot.action('fc:home', auth_1.adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        await showChannels(ctx);
    });
    bot.action('fc:add', auth_1.adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        await askChannel(ctx);
    });
    bot.action('fc:t', auth_1.adminOnly, async (ctx) => {
        const on = !(await (0, settings_1.getSettings)()).forceJoinEnabled;
        await (0, settings_1.setSetting)('forceJoinEnabled', on);
        await ctx.answerCbQuery(on ? 'Force join ON' : 'Force join OFF');
        await showChannels(ctx);
    });
    bot.action(/^fc:d:(-?\d+)$/, auth_1.adminOnly, async (ctx) => {
        const id = ctx.match[1];
        const c = (await (0, channels_1.listChannels)()).find((x) => String(x.chatId) === id);
        await ctx.answerCbQuery();
        if (!c)
            return showChannels(ctx, '⚠️ Channel not found.');
        await (0, ui_1.editOrReply)(ctx, `🗑 <b>Remove this channel?</b>\n\n${(0, ui_1.esc)(c.title)} • ${(0, ui_1.esc)(kindLabel(c))}\n<code>${c.chatId}</code>\n${(0, channels_1.joinUrl)(c) ? `Link: ${(0, ui_1.esc)((0, channels_1.joinUrl)(c))}\n` : ''}\nUsers will no longer need to join it.`, telegraf_1.Markup.inlineKeyboard([[cb('✅ Yes, remove', `fc:r:${c.chatId}`), cb('✖️ No', 'fc:home')]]));
    });
    bot.action(/^fc:r:(-?\d+)$/, auth_1.adminOnly, async (ctx) => {
        const gone = await (0, channels_1.removeChannel)(Number(ctx.match[1]));
        await ctx.answerCbQuery(gone ? 'Removed' : 'Not found');
        await showChannels(ctx, gone ? `🗑 Removed <b>${(0, ui_1.esc)(gone.title)}</b>.` : undefined);
    });
}
//# sourceMappingURL=channels.js.map