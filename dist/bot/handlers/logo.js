"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLogoMedia = getLogoMedia;
exports.replyWithLogo = replyWithLogo;
exports.showLogoEditor = showLogoEditor;
exports.handleLogoText = handleLogoText;
exports.registerLogoHandlers = registerLogoHandlers;
const telegraf_1 = require("telegraf");
const ui_1 = require("../ui");
const auth_1 = require("../middlewares/auth");
const settings_1 = require("../../services/settings");
const settingsParser_1 = require("../../services/settingsParser");
const Setting_1 = require("../../models/Setting");
const logger_1 = require("../../utils/logger");
const cb = telegraf_1.Markup.button.callback;
const STATE_TTL_MS = 30 * 60_000;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // Telegram limit for sendPhoto
const MEDIA_LABEL = {
    photo: 'Image',
    animation: 'GIF / animation',
    sticker: 'Sticker',
    document: 'Image file',
};
/** The logo image saved in settings (null when none / unreadable). */
function getLogoMedia() {
    const raw = (0, settings_1.getCachedSettings)().shopLogoMedia;
    if (!raw)
        return null;
    try {
        const m = JSON.parse(raw);
        if (m && typeof m.fileId === 'string' && m.fileId && ['photo', 'animation', 'sticker', 'document'].includes(String(m.type))) {
            return { type: m.type, fileId: m.fileId };
        }
    }
    catch {
        /* ignore */
    }
    return null;
}
async function sendMedia(ctx, media, caption, extra) {
    const opts = { reply_markup: extra?.reply_markup };
    if (caption !== undefined) {
        opts.caption = caption;
        opts.parse_mode = 'HTML';
    }
    switch (media.type) {
        case 'photo':
            await ctx.replyWithPhoto(media.fileId, opts);
            break;
        case 'animation':
            await ctx.replyWithAnimation(media.fileId, opts);
            break;
        case 'sticker':
            await ctx.replyWithSticker(media.fileId, { reply_markup: extra?.reply_markup });
            break;
        default:
            await ctx.replyWithDocument(media.fileId, opts);
    }
}
/**
 * Sends `text` (HTML). If the admin set a logo image, it is sent together with the text as the caption
 * (stickers can't have captions, so they are sent first). Falls back to a plain text message when the
 * image can't be sent, so customers never get an error because of the logo.
 */
async function replyWithLogo(ctx, text, extra = {}) {
    const media = getLogoMedia();
    if (media) {
        try {
            const asCaption = media.type !== 'sticker' && text.length <= 1000; // Telegram caption limit is 1024
            await sendMedia(ctx, media, asCaption ? text : undefined, extra);
            if (asCaption)
                return;
        }
        catch (e) {
            logger_1.logger.warn({ err: e instanceof Error ? e.message : String(e) }, 'Could not send the shop logo image; sending text only');
        }
    }
    await ctx.reply(text, { ...ui_1.HTML, ...extra });
}
// ---------------------------------------------------------------------
//  Admin editor
// ---------------------------------------------------------------------
async function showLogoEditor(ctx) {
    await (0, ui_1.clearState)(ctx.dbUser._id);
    await (0, settings_1.getSettings)();
    const media = getLogoMedia();
    const emoji = (0, settings_1.getCachedSettings)().shopLogo;
    const groups = [...new Set(Setting_1.SETTING_DEFS.map((d) => d.group))];
    const rows = [
        [cb('😀 Change emoji', 'lg:emoji'), cb('🖼 Change image', 'lg:set')],
        [cb('👁 Preview', 'lg:prev')],
    ];
    const remove = [];
    if (media)
        remove.push(cb('🗑 Remove image', 'lg:rmimg'));
    if (emoji)
        remove.push(cb('🚫 Remove emoji', 'lg:rmemoji'));
    if (remove.length)
        rows.push(remove);
    rows.push([cb('♻️ Reset logo to default', 'lg:reset')]);
    rows.push([cb('⬅️ Back', `se:g:${Math.max(0, groups.indexOf('Shop'))}`)]);
    await (0, ui_1.editOrReply)(ctx, [
        '🖼 <b>Shop logo</b>',
        '',
        `Emoji: <b>${emoji ? (0, ui_1.esc)(emoji) : 'none'}</b>`,
        `Image: <b>${media ? MEDIA_LABEL[media.type] : 'none'}</b>`,
        '',
        `Header: <b>${(0, ui_1.shopTitle)()}</b>`,
        '',
        '• The <b>emoji</b> is shown before the shop name on every screen.',
        '• The <b>image / GIF / sticker</b> is shown with the welcome message (/start).',
    ].join('\n'), telegraf_1.Markup.inlineKeyboard(rows));
}
async function askEmoji(ctx) {
    await (0, ui_1.setState)(ctx.dbUser._id, 'awaiting_shop_logo');
    await (0, ui_1.editOrReply)(ctx, [
        '😀 <b>Send the new emoji now</b>',
        '',
        'Any emoji, e.g. 🏪 🛒 🔥 💎 🎮',
        'It is shown before the shop name on every screen.',
        'Send <code>-</code> to remove it.  /cancel to stop.',
    ].join('\n'), telegraf_1.Markup.inlineKeyboard([[cb('⬅️ Back', 'lg:home')]]));
}
async function askLogo(ctx) {
    await (0, ui_1.setState)(ctx.dbUser._id, 'awaiting_shop_logo');
    await (0, ui_1.editOrReply)(ctx, [
        '🖼 <b>Send the new logo image now</b>',
        '',
        '🖼 a <b>photo</b> or an image <b>file</b> (JPG / PNG / WEBP)',
        '🎞 a <b>GIF</b> / animation',
        '🏷 a <b>sticker</b>',
        '',
        '/cancel to stop.',
    ].join('\n'), telegraf_1.Markup.inlineKeyboard([[cb('⬅️ Back', 'lg:home')]]));
}
/** Text sent while waiting for the logo: it becomes the logo emoji (send - to remove). */
async function handleLogoText(ctx, text) {
    if (!ctx.isAdmin) {
        await ctx.reply('⛔ Admin only.');
        return;
    }
    const def = Setting_1.SETTING_DEFS.find((d) => d.key === 'shopLogo');
    const parsed = (0, settingsParser_1.parseSettingInput)(def, text);
    if (!parsed.ok) {
        await ctx.reply(`❌ ${parsed.error}\n\nSend an emoji, an image, a GIF or a sticker (or /cancel).`);
        return;
    }
    await (0, settings_1.setSetting)('shopLogo', parsed.value);
    await ctx.reply(parsed.value ? `✅ Logo emoji saved: ${(0, ui_1.esc)(parsed.value)}` : '✅ Logo emoji removed.');
    await showLogoEditor(ctx);
}
/** Re-uploads an image sent as a FILE so it can be shown as a normal photo (needed to put it in a caption). */
async function documentToPhoto(ctx, doc) {
    try {
        if ((doc.file_size ?? 0) > MAX_PHOTO_BYTES)
            return null;
        const link = await ctx.telegram.getFileLink(doc.file_id);
        const res = await fetch(link.href);
        if (!res.ok)
            return null;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_PHOTO_BYTES)
            return null;
        const sent = await ctx.telegram.sendPhoto(ctx.chat.id, { source: buf });
        await ctx.telegram.deleteMessage(ctx.chat.id, sent.message_id).catch(() => undefined);
        return sent.photo[sent.photo.length - 1]?.file_id ?? null;
    }
    catch {
        return null;
    }
}
async function saveMedia(ctx, media) {
    await (0, settings_1.setSetting)('shopLogoMedia', JSON.stringify(media));
    await ctx.reply(`✅ Logo ${MEDIA_LABEL[media.type].toLowerCase()} saved. Customers will see it with the welcome message.`);
    await showLogoEditor(ctx);
}
// ---------------------------------------------------------------------
//  Registration
// ---------------------------------------------------------------------
function registerLogoHandlers(bot) {
    // The admin's next photo / file / GIF / sticker becomes the logo image.
    // Registered BEFORE the product file handler so images are not mistaken for uploads.
    bot.on('message', async (ctx, next) => {
        const st = ctx.dbUser?.state;
        const waiting = ctx.isAdmin && st?.name === 'awaiting_shop_logo' && st.at && Date.now() - new Date(st.at).getTime() < STATE_TTL_MS;
        if (!waiting)
            return next();
        const m = ctx.message;
        if (m.text)
            return next(); // emoji / text goes to the text router -> handleLogoText
        if (m.photo?.length) {
            return saveMedia(ctx, { type: 'photo', fileId: m.photo[m.photo.length - 1].file_id });
        }
        if (m.animation) {
            return saveMedia(ctx, { type: 'animation', fileId: m.animation.file_id });
        }
        if (m.sticker) {
            return saveMedia(ctx, { type: 'sticker', fileId: m.sticker.file_id });
        }
        if (m.document) {
            const mime = String(m.document.mime_type ?? '');
            if (!mime.startsWith('image/')) {
                return ctx.reply('❌ That file is not an image. Send a photo, an image file (JPG / PNG / WEBP), a GIF, a sticker or an emoji (or /cancel).');
            }
            await ctx.reply('⏳ Processing image…');
            const photoId = await documentToPhoto(ctx, m.document);
            // could not convert (very large / unsupported): keep it as a file so it still works
            return saveMedia(ctx, photoId ? { type: 'photo', fileId: photoId } : { type: 'document', fileId: m.document.file_id });
        }
        return ctx.reply('❌ Please send an emoji, a photo, an image file, a GIF or a sticker (or /cancel).');
    });
    const act = (re, fn) => bot.action(re, auth_1.adminOnly, async (ctx) => {
        await ctx.answerCbQuery().catch(() => undefined);
        await fn(ctx);
    });
    act('lg:home', showLogoEditor);
    act('lg:emoji', askEmoji);
    act('lg:set', askLogo);
    act('lg:prev', async (ctx) => {
        await replyWithLogo(ctx, `<b>${(0, ui_1.shopTitle)()}</b>\n\n👆 This is how your logo looks.`);
    });
    act('lg:rmimg', async (ctx) => {
        await (0, settings_1.setSetting)('shopLogoMedia', '');
        await showLogoEditor(ctx);
    });
    act('lg:rmemoji', async (ctx) => {
        await (0, settings_1.setSetting)('shopLogo', '');
        await showLogoEditor(ctx);
    });
    act('lg:reset', async (ctx) => {
        await (0, settings_1.resetSetting)('shopLogo');
        await (0, settings_1.resetSetting)('shopLogoMedia');
        await showLogoEditor(ctx);
    });
}
//# sourceMappingURL=logo.js.map