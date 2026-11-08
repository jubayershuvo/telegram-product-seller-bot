import { Markup, Telegraf } from 'telegraf';
import { BotContext } from '../context';
import { HTML, clearState, commandArgs, editOrReply, esc, setState } from '../ui';
import { adminOnly } from '../middlewares/auth';
import { getSettings, setSetting } from '../../services/settings';
import { ChannelLean, addChannel, joinUrl, listChannels, removeChannel, resolveChat, splitChannelInput } from '../../services/channels';
import { AppError, safeError } from '../../utils/errors';
import { logger } from '../../utils/logger';

const cb = Markup.button.callback;
const trunc = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const STATE_TTL_MS = 30 * 60_000;

const kindLabel = (c: ChannelLean) => (c.username ? `@${c.username}` : 'private');

// =====================================================================
//  Screens (reachable from Settings → "Required channels" and /channels)
// =====================================================================
export async function showChannels(ctx: BotContext, notice?: string) {
  await clearState(ctx.dbUser._id);
  const [list, s] = await Promise.all([listChannels(), getSettings()]);
  const lines = [
    '📢 <b>Required channels</b>',
    notice ?? '',
    `Force join: ${s.forceJoinEnabled ? '🟢 <b>ON</b>' : '🔴 <b>OFF</b>'}${s.forceJoinEnabled && !list.length ? ' (no channel added yet, so nobody is blocked)' : ''}`,
    '',
    list.length ? list.map((c, i) => `${i + 1}. ${esc(c.title)} • ${esc(kindLabel(c))} • <code>${c.chatId}</code>`).join('\n') : 'No channels added yet.',
    '',
    'Tap a channel to remove it, or add a new one.',
  ].filter((l, i) => i !== 1 || l !== '');

  const rows = list.map((c) => [cb(`🗑 ${trunc(c.title, 28)} (${kindLabel(c)})`, `fc:d:${c.chatId}`)]);
  rows.push([cb('➕ Add channel', 'fc:add')]);
  rows.push([cb(s.forceJoinEnabled ? '🔴 Turn force join OFF' : '🟢 Turn force join ON', 'fc:t')]);
  rows.push([cb('⬅️ Settings', 'se:home')]);
  await editOrReply(ctx, lines.join('\n'), Markup.inlineKeyboard(rows));
}

async function askChannel(ctx: BotContext) {
  await setState(ctx.dbUser._id, 'awaiting_channel');
  await editOrReply(
    ctx,
    [
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
    ].join('\n'),
    Markup.inlineKeyboard([[cb('⬅️ Back', 'fc:home')]]),
  );
}

async function saveChannel(ctx: BotContext, ref: string | number, invite?: string): Promise<boolean> {
  try {
    const chat = await resolveChat(ctx.telegram, ref);
    const { channel, created } = await addChannel(ctx.telegram, ctx.from!.id, { chat, inviteLink: invite });
    await clearState(ctx.dbUser._id);
    await ctx.reply(`✅ ${created ? 'Added' : 'Updated'}: <b>${esc(channel.title)}</b> (${esc(kindLabel(channel))})`, HTML);
    await showChannels(ctx);
    return true;
  } catch (e) {
    if (e instanceof AppError) await ctx.reply(`❌ ${e.message}\n\nTry again or /cancel.`, HTML);
    else {
      logger.error({ err: safeError(e) }, 'Add channel failed');
      await ctx.reply('❌ Could not add that channel. Check the logs.');
    }
    return false;
  }
}

/** Called by the text router while the admin is in the "awaiting_channel" step. */
export async function handleChannelInput(ctx: BotContext, text: string) {
  if (!ctx.isAdmin) return ctx.reply('⛔ Admin only.');
  const { ref, invite } = splitChannelInput(text.split(/\s+/));
  if (!ref) return ctx.reply('❌ Send @username, a t.me link or the numeric ID. /cancel to stop.');
  await saveChannel(ctx, ref, invite);
}

// =====================================================================
//  Registration
// =====================================================================
export function registerChannelHandlers(bot: Telegraf<BotContext>) {
  // forwarded message from a channel while "Add channel" is waiting for input (works for private channels too)
  bot.on('message', async (ctx, next) => {
    const st = ctx.dbUser?.state;
    const waiting = ctx.isAdmin && st?.name === 'awaiting_channel' && st.at && Date.now() - new Date(st.at).getTime() < STATE_TTL_MS;
    if (!waiting) return next();
    const m = ctx.message as any;
    const origin = m.forward_origin?.type === 'channel' ? m.forward_origin.chat : m.forward_from_chat;
    if (!origin) return next(); // normal text goes on to the text router
    await saveChannel(ctx, origin.id);
  });

  bot.command(['channels', 'channel_list'], adminOnly, (ctx) => showChannels(ctx));

  // /addchannel @username   |   /addchannel -1001234567890 [https://t.me/+invite]
  bot.command('addchannel', adminOnly, async (ctx) => {
    const { ref, invite } = splitChannelInput(commandArgs(ctx));
    if (!ref) return ctx.reply('Usage:\n/addchannel @username\n/addchannel -1001234567890 https://t.me/+invite\n\nOr use Settings → Required channels (you can also forward a message from the channel there).');
    await saveChannel(ctx, ref, invite);
  });

  bot.command(['removechannel', 'delchannel'], adminOnly, async (ctx) => {
    const ref = commandArgs(ctx)[0];
    if (!ref) return ctx.reply('Usage: /removechannel <@username|channel id>');
    const gone = await removeChannel(ref);
    await ctx.reply(gone ? `🗑 Removed: ${gone.title}` : 'Channel not found. See /channels.');
  });

  bot.command('forcejoin', adminOnly, async (ctx) => {
    const a = (commandArgs(ctx)[0] ?? '').toLowerCase();
    if (!['on', 'off'].includes(a)) return ctx.reply(`Force join is ${(await getSettings()).forceJoinEnabled ? 'ON' : 'OFF'}.\nUsage: /forcejoin on|off`);
    await setSetting('forceJoinEnabled', a === 'on');
    await ctx.reply(`Force join turned ${a.toUpperCase()}.`);
  });

  // ----- buttons -----
  bot.action('fc:home', adminOnly, async (ctx) => {
    await ctx.answerCbQuery();
    await showChannels(ctx);
  });
  bot.action('fc:add', adminOnly, async (ctx) => {
    await ctx.answerCbQuery();
    await askChannel(ctx);
  });
  bot.action('fc:t', adminOnly, async (ctx) => {
    const on = !(await getSettings()).forceJoinEnabled;
    await setSetting('forceJoinEnabled', on);
    await ctx.answerCbQuery(on ? 'Force join ON' : 'Force join OFF');
    await showChannels(ctx);
  });
  bot.action(/^fc:d:(-?\d+)$/, adminOnly, async (ctx) => {
    const id = ctx.match[1];
    const c = (await listChannels()).find((x) => String(x.chatId) === id);
    await ctx.answerCbQuery();
    if (!c) return showChannels(ctx, '⚠️ Channel not found.');
    await editOrReply(
      ctx,
      `🗑 <b>Remove this channel?</b>\n\n${esc(c.title)} • ${esc(kindLabel(c))}\n<code>${c.chatId}</code>\n${joinUrl(c) ? `Link: ${esc(joinUrl(c))}\n` : ''}\nUsers will no longer need to join it.`,
      Markup.inlineKeyboard([[cb('✅ Yes, remove', `fc:r:${c.chatId}`), cb('✖️ No', 'fc:home')]]),
    );
  });
  bot.action(/^fc:r:(-?\d+)$/, adminOnly, async (ctx) => {
    const gone = await removeChannel(Number(ctx.match[1]));
    await ctx.answerCbQuery(gone ? 'Removed' : 'Not found');
    await showChannels(ctx, gone ? `🗑 Removed <b>${esc(gone.title)}</b>.` : undefined);
  });
}
