"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerBroadcastHandlers = registerBroadcastHandlers;
const telegraf_1 = require("telegraf");
const ui_1 = require("../ui");
const auth_1 = require("../middlewares/auth");
const broadcast_1 = require("../../services/broadcast");
const logger_1 = require("../../utils/logger");
const errors_1 = require("../../utils/errors");
const cb = telegraf_1.Markup.button.callback;
const STATE_TTL_MS = 30 * 60_000;
const bar = (done, total) => {
    const pct = total ? Math.min(100, Math.floor((done / total) * 100)) : 100;
    const filled = Math.round(pct / 10);
    return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${pct}%`;
};
function statsText(s, title) {
    const done = s.sent + s.failed;
    const secs = Math.max(1, Math.round((Date.now() - s.startedAt) / 1000));
    return [
        title,
        '',
        bar(done, s.total),
        `📨 Processed: <b>${done}</b> / ${s.total}`,
        `✅ Successful: <b>${s.sent}</b>`,
        `❌ Failed: <b>${s.failed}</b>${s.blocked ? ` (🚫 blocked the bot: ${s.blocked})` : ''}`,
        s.floodWaits ? `⏳ Telegram rate-limit pauses: ${s.floodWaits}` : '',
        `🕒 Time: ${secs}s`,
    ]
        .filter(Boolean)
        .join('\n');
}
async function askMessage(ctx) {
    if ((0, broadcast_1.isBroadcastRunning)())
        return ctx.reply('⏳ A broadcast is already running. Wait for it to finish (or cancel it with the button on its progress message).');
    await (0, ui_1.setState)(ctx.dbUser._id, 'awaiting_broadcast');
    await ctx.reply([
        '📣 <b>Broadcast</b>',
        '',
        'Send the message you want to broadcast now. It can be <b>text</b> or <b>media</b> (photo, video, document, audio, voice, GIF, sticker…) with an optional caption.',
        'Formatting and captions are kept exactly as you send them.',
        '',
        '/cancel to stop.',
    ].join('\n'), ui_1.HTML);
}
function registerBroadcastHandlers(bot) {
    bot.command('broadcast', auth_1.adminOnly, askMessage);
    bot.action('bc:start', auth_1.adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        await askMessage(ctx);
    });
    // The admin's next message (any type) becomes the broadcast content.
    bot.on('message', async (ctx, next) => {
        const st = ctx.dbUser?.state;
        const waiting = ctx.isAdmin && st?.name === 'awaiting_broadcast' && st.at && Date.now() - new Date(st.at).getTime() < STATE_TTL_MS;
        if (!waiting)
            return next();
        const m = ctx.message;
        if (m.text?.startsWith('/'))
            return next(); // /cancel etc. keep working
        // preview = exactly what users will receive; also proves the message type can be copied
        try {
            await (0, broadcast_1.sendBroadcastContent)(ctx.telegram, ctx.chat.id, { chatId: ctx.chat.id, messageId: m.message_id, text: m.text, entities: m.entities });
        }
        catch {
            return ctx.reply('❌ That message type cannot be broadcast. Send text or a photo/video/document/audio/voice/GIF/sticker, or /cancel.');
        }
        const a = await (0, broadcast_1.audienceInfo)();
        await (0, ui_1.setState)(ctx.dbUser._id, 'broadcast_confirm', { messageId: m.message_id, text: m.text ?? null, entities: m.entities ?? null });
        await ctx.reply([
            '👆 <b>This is what users will receive.</b>',
            '',
            `👥 Recipients: <b>${a.receivers}</b> of ${a.total} users`,
            a.banned || a.blocked ? `(skipping ${a.banned} banned and ${a.blocked} who blocked the bot)` : '',
            '',
            'Send it now?',
        ]
            .filter(Boolean)
            .join('\n'), { ...ui_1.HTML, ...telegraf_1.Markup.inlineKeyboard([[cb(`✅ Send to ${a.receivers} users`, 'bc:go'), cb('✖️ Cancel', 'bc:no')]]) });
    });
    bot.action('bc:no', auth_1.adminOnly, async (ctx) => {
        await ctx.answerCbQuery('Cancelled');
        await (0, ui_1.clearState)(ctx.dbUser._id);
        await ctx.editMessageText('Broadcast cancelled.').catch(() => undefined);
    });
    bot.action('bc:go', auth_1.adminOnly, async (ctx) => {
        const st = ctx.dbUser.state;
        const messageId = Number(st?.data?.messageId);
        const fresh = st?.name === 'broadcast_confirm' && st.at && Date.now() - new Date(st.at).getTime() < STATE_TTL_MS;
        if (!fresh || !messageId) {
            await ctx.answerCbQuery('Expired, start again with /broadcast', { show_alert: true });
            return;
        }
        if ((0, broadcast_1.isBroadcastRunning)())
            return ctx.answerCbQuery('A broadcast is already running.', { show_alert: true });
        await ctx.answerCbQuery('Broadcast started 🚀');
        await (0, ui_1.clearState)(ctx.dbUser._id);
        const chatId = ctx.chat.id;
        const adminId = ctx.from.id;
        const progress = await ctx.editMessageText('📣 <b>Broadcasting…</b>\n\nStarting…', { ...ui_1.HTML, ...telegraf_1.Markup.inlineKeyboard([[cb('🛑 Stop', 'bc:stop')]]) }).catch(() => undefined);
        const progressMsgId = progress && typeof progress === 'object' && 'message_id' in progress ? progress.message_id : ctx.callbackQuery?.message?.message_id;
        const edit = async (text, keyboard = true) => {
            if (!progressMsgId)
                return;
            await ctx.telegram
                .editMessageText(chatId, progressMsgId, undefined, text, { ...ui_1.HTML, ...(keyboard ? telegraf_1.Markup.inlineKeyboard([[cb('🛑 Stop', 'bc:stop')]]) : {}) })
                .catch(() => undefined);
        };
        try {
            const ok = await (0, broadcast_1.startBroadcast)({
                telegram: ctx.telegram,
                adminId,
                source: {
                    chatId,
                    messageId,
                    text: typeof st?.data?.text === 'string' ? st.data.text : undefined,
                    entities: Array.isArray(st?.data?.entities) ? st.data.entities : undefined,
                },
                onProgress: (s) => edit(statsText(s, '📣 <b>Broadcasting…</b>')),
                onDone: async (s) => {
                    const title = s.status === 'completed' ? '✅ <b>Broadcast finished</b>' : s.status === 'cancelled' ? '🛑 <b>Broadcast stopped</b>' : '⚠️ <b>Broadcast interrupted</b>';
                    await edit(`${title}\n\nSummary below 👇`, false);
                    await ctx.telegram.sendMessage(chatId, statsText(s, title), ui_1.HTML).catch(() => undefined);
                },
            });
            if (!ok)
                await edit('⏳ A broadcast is already running.', false);
        }
        catch (e) {
            logger_1.logger.error({ err: (0, errors_1.safeError)(e) }, 'Could not start broadcast');
            await edit('❌ Could not start the broadcast. Check the logs.', false);
        }
    });
    bot.action('bc:stop', auth_1.adminOnly, async (ctx) => {
        const ok = (0, broadcast_1.cancelBroadcast)();
        await ctx.answerCbQuery(ok ? 'Stopping after the current batch…' : 'No broadcast is running.', { show_alert: !ok });
    });
}
//# sourceMappingURL=broadcast.js.map