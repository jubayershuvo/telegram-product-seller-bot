import { Markup, Telegraf } from 'telegraf';
import { BotContext } from '../context';
import { HTML, clearState, editOrReply, esc, setState, shopTitle } from '../ui';
import { adminOnly } from '../middlewares/auth';
import { getCachedSettings, getSettings, resetSetting, setSetting } from '../../services/settings';
import { parseSettingInput } from '../../services/settingsParser';
import { SETTING_DEFS } from '../../models/Setting';
import { logger } from '../../utils/logger';

const cb = Markup.button.callback;
const STATE_TTL_MS = 30 * 60_000;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // Telegram limit for sendPhoto

export type LogoMediaType = 'photo' | 'animation' | 'sticker' | 'document';
export interface LogoMedia {
  type: LogoMediaType;
  fileId: string;
}

const MEDIA_LABEL: Record<LogoMediaType, string> = {
  photo: 'Image',
  animation: 'GIF / animation',
  sticker: 'Sticker',
  document: 'Image file',
};

/** The logo image saved in settings (null when none / unreadable). */
export function getLogoMedia(): LogoMedia | null {
  const raw = getCachedSettings().shopLogoMedia;
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as Partial<LogoMedia>;
    if (m && typeof m.fileId === 'string' && m.fileId && ['photo', 'animation', 'sticker', 'document'].includes(String(m.type))) {
      return { type: m.type as LogoMediaType, fileId: m.fileId };
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function sendMedia(ctx: BotContext, media: LogoMedia, caption: string | undefined, extra: any): Promise<void> {
  const opts: any = { reply_markup: extra?.reply_markup };
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
export async function replyWithLogo(ctx: BotContext, text: string, extra: object = {}): Promise<void> {
  const media = getLogoMedia();
  if (media) {
    try {
      const asCaption = media.type !== 'sticker' && text.length <= 1000; // Telegram caption limit is 1024
      await sendMedia(ctx, media, asCaption ? text : undefined, extra);
      if (asCaption) return;
    } catch (e) {
      logger.warn({ err: e instanceof Error ? e.message : String(e) }, 'Could not send the shop logo image; sending text only');
    }
  }
  await ctx.reply(text, { ...HTML, ...extra } as any);
}

// ---------------------------------------------------------------------
//  Admin editor
// ---------------------------------------------------------------------
export async function showLogoEditor(ctx: BotContext): Promise<void> {
  await clearState(ctx.dbUser._id);
  await getSettings();
  const media = getLogoMedia();
  const emoji = getCachedSettings().shopLogo;
  const groups = [...new Set(SETTING_DEFS.map((d) => d.group))];
  const rows = [
    [cb('😀 Change emoji', 'lg:emoji'), cb('🖼 Change image', 'lg:set')],
    [cb('👁 Preview', 'lg:prev')],
  ];
  const remove = [];
  if (media) remove.push(cb('🗑 Remove image', 'lg:rmimg'));
  if (emoji) remove.push(cb('🚫 Remove emoji', 'lg:rmemoji'));
  if (remove.length) rows.push(remove);
  rows.push([cb('♻️ Reset logo to default', 'lg:reset')]);
  rows.push([cb('⬅️ Back', `se:g:${Math.max(0, groups.indexOf('Shop'))}`)]);

  await editOrReply(
    ctx,
    [
      '🖼 <b>Shop logo</b>',
      '',
      `Emoji: <b>${emoji ? esc(emoji) : 'none'}</b>`,
      `Image: <b>${media ? MEDIA_LABEL[media.type] : 'none'}</b>`,
      '',
      `Header: <b>${shopTitle()}</b>`,
      '',
      '• The <b>emoji</b> is shown before the shop name on every screen.',
      '• The <b>image / GIF / sticker</b> is shown with the welcome message (/start).',
    ].join('\n'),
    Markup.inlineKeyboard(rows),
  );
}

async function askEmoji(ctx: BotContext): Promise<void> {
  await setState(ctx.dbUser._id, 'awaiting_shop_logo');
  await editOrReply(
    ctx,
    [
      '😀 <b>Send the new emoji now</b>',
      '',
      'Any emoji, e.g. 🏪 🛒 🔥 💎 🎮',
      'It is shown before the shop name on every screen.',
      'Send <code>-</code> to remove it.  /cancel to stop.',
    ].join('\n'),
    Markup.inlineKeyboard([[cb('⬅️ Back', 'lg:home')]]),
  );
}

async function askLogo(ctx: BotContext): Promise<void> {
  await setState(ctx.dbUser._id, 'awaiting_shop_logo');
  await editOrReply(
    ctx,
    [
      '🖼 <b>Send the new logo image now</b>',
      '',
      '🖼 a <b>photo</b> or an image <b>file</b> (JPG / PNG / WEBP)',
      '🎞 a <b>GIF</b> / animation',
      '🏷 a <b>sticker</b>',
      '',
      '/cancel to stop.',
    ].join('\n'),
    Markup.inlineKeyboard([[cb('⬅️ Back', 'lg:home')]]),
  );
}

/** Text sent while waiting for the logo: it becomes the logo emoji (send - to remove). */
export async function handleLogoText(ctx: BotContext, text: string): Promise<void> {
  if (!ctx.isAdmin) {
    await ctx.reply('⛔ Admin only.');
    return;
  }
  const def = SETTING_DEFS.find((d) => d.key === 'shopLogo')!;
  const parsed = parseSettingInput(def, text);
  if (!parsed.ok) {
    await ctx.reply(`❌ ${parsed.error}\n\nSend an emoji, an image, a GIF or a sticker (or /cancel).`);
    return;
  }
  await setSetting('shopLogo', parsed.value as string);
  await ctx.reply(parsed.value ? `✅ Logo emoji saved: ${esc(parsed.value as string)}` : '✅ Logo emoji removed.');
  await showLogoEditor(ctx);
}

/** Re-uploads an image sent as a FILE so it can be shown as a normal photo (needed to put it in a caption). */
async function documentToPhoto(ctx: BotContext, doc: { file_id: string; file_size?: number }): Promise<string | null> {
  try {
    if ((doc.file_size ?? 0) > MAX_PHOTO_BYTES) return null;
    const link = await ctx.telegram.getFileLink(doc.file_id);
    const res = await fetch(link.href);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_PHOTO_BYTES) return null;
    const sent = await ctx.telegram.sendPhoto(ctx.chat!.id, { source: buf });
    await ctx.telegram.deleteMessage(ctx.chat!.id, sent.message_id).catch(() => undefined);
    return sent.photo[sent.photo.length - 1]?.file_id ?? null;
  } catch {
    return null;
  }
}

async function saveMedia(ctx: BotContext, media: LogoMedia): Promise<void> {
  await setSetting('shopLogoMedia', JSON.stringify(media));
  await ctx.reply(`✅ Logo ${MEDIA_LABEL[media.type].toLowerCase()} saved. Customers will see it with the welcome message.`);
  await showLogoEditor(ctx);
}

// ---------------------------------------------------------------------
//  Registration
// ---------------------------------------------------------------------
export function registerLogoHandlers(bot: Telegraf<BotContext>) {
  // The admin's next photo / file / GIF / sticker becomes the logo image.
  // Registered BEFORE the product file handler so images are not mistaken for uploads.
  bot.on('message', async (ctx, next) => {
    const st = ctx.dbUser?.state;
    const waiting = ctx.isAdmin && st?.name === 'awaiting_shop_logo' && st.at && Date.now() - new Date(st.at).getTime() < STATE_TTL_MS;
    if (!waiting) return next();
    const m = ctx.message as any;
    if (m.text) return next(); // emoji / text goes to the text router -> handleLogoText

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

  const act = (re: RegExp | string, fn: (ctx: any) => Promise<unknown>) =>
    bot.action(re, adminOnly, async (ctx: any) => {
      await ctx.answerCbQuery().catch(() => undefined);
      await fn(ctx);
    });

  act('lg:home', showLogoEditor);
  act('lg:emoji', askEmoji);
  act('lg:set', askLogo);
  act('lg:prev', async (ctx) => {
    await replyWithLogo(ctx, `<b>${shopTitle()}</b>\n\n👆 This is how your logo looks.`);
  });
  act('lg:rmimg', async (ctx) => {
    await setSetting('shopLogoMedia', '');
    await showLogoEditor(ctx);
  });
  act('lg:rmemoji', async (ctx) => {
    await setSetting('shopLogo', '');
    await showLogoEditor(ctx);
  });
  act('lg:reset', async (ctx) => {
    await resetSetting('shopLogo');
    await resetSetting('shopLogoMedia');
    await showLogoEditor(ctx);
  });
}
