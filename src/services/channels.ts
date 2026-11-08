import { Telegram } from 'telegraf';
import { Channel } from '../models/Channel';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { notifyAdmins } from '../bot/notify';

export type ChannelLean = {
  chatId: number;
  type: string;
  title: string;
  username?: string;
  inviteLink?: string;
};

// ---------------------------------------------------------------------------
//  Required channel list (tiny in-memory cache, invalidated on every change)
// ---------------------------------------------------------------------------
let listCache: { at: number; list: ChannelLean[] } | null = null;
const LIST_TTL_MS = 5_000;

export async function listChannels(): Promise<ChannelLean[]> {
  if (listCache && Date.now() - listCache.at < LIST_TTL_MS) return listCache.list;
  const list = (await Channel.find().sort({ createdAt: 1 }).lean()) as unknown as ChannelLean[];
  listCache = { at: Date.now(), list };
  return list;
}

function invalidate() {
  listCache = null;
  okCache.clear();
}

export const joinUrl = (c: ChannelLean): string | undefined => (c.username ? `https://t.me/${c.username}` : c.inviteLink || undefined);

// ---------------------------------------------------------------------------
//  Resolving what the admin typed / forwarded into a real chat
// ---------------------------------------------------------------------------
const INVITE_RE = /^(?:https?:\/\/)?t\.me\/(?:\+|joinchat\/)[\w-]+/i;

/** Splits "<channel> [invite link]" input into the channel reference and an optional invite link. */
export function splitChannelInput(tokens: string[]): { ref?: string; invite?: string } {
  let ref: string | undefined;
  let invite: string | undefined;
  for (const t of tokens) {
    if (INVITE_RE.test(t)) invite = t.startsWith('http') ? t : `https://${t}`;
    else if (!ref) ref = t;
  }
  return { ref, invite };
}

function normalizeRef(raw: string): string | number {
  let t = raw.trim();
  t = t.replace(/^https?:\/\//i, '').replace(/^t\.me\//i, '').replace(/^@/, '').replace(/\/+$/, '');
  if (/^-?\d+$/.test(t)) return Number(t);
  if (!/^[A-Za-z][A-Za-z0-9_]{3,}$/.test(t)) throw new AppError('Send a channel as @username, a t.me/username link or its numeric ID (e.g. -1001234567890).');
  return `@${t}`;
}

export interface ResolvedChat {
  chatId: number;
  type: string;
  title: string;
  username?: string;
  inviteLink?: string;
}

export async function resolveChat(tg: Telegram, ref: string | number): Promise<ResolvedChat> {
  const target = typeof ref === 'number' ? ref : normalizeRef(ref);
  let chat: any;
  try {
    chat = await tg.getChat(target);
  } catch {
    throw new AppError('Channel not found. Make sure the username/ID is right and the bot has been added to the channel as an admin.');
  }
  if (!['channel', 'supergroup', 'group'].includes(chat.type)) throw new AppError('That is not a channel or group.');
  return { chatId: chat.id, type: chat.type, title: chat.title ?? String(chat.id), username: chat.username, inviteLink: chat.invite_link };
}

/** The bot must be an admin of the channel, otherwise Telegram will not let it read the member list. */
async function assertBotIsAdmin(tg: Telegram, chatId: number): Promise<void> {
  const me = await tg.getMe();
  try {
    const m = await tg.getChatMember(chatId, me.id);
    if (m.status !== 'administrator' && m.status !== 'creator') throw new Error('not admin');
  } catch {
    throw new AppError('The bot must be an <b>administrator</b> of that channel to verify members. Add it as admin there, then try again.');
  }
}

export async function addChannel(tg: Telegram, adminId: number, input: { chat: ResolvedChat; inviteLink?: string }): Promise<{ channel: ChannelLean; created: boolean; warning?: string }> {
  const { chat } = input;
  await assertBotIsAdmin(tg, chat.chatId);

  let inviteLink = input.inviteLink || undefined;
  let warning: string | undefined;
  if (!chat.username && !inviteLink) {
    // private channel: we need a link for the Join button
    try {
      const link = await tg.createChatInviteLink(chat.chatId, { name: 'Bot force-join' });
      inviteLink = link.invite_link;
    } catch {
      inviteLink = chat.inviteLink;
    }
    if (!inviteLink) {
      throw new AppError('This is a private channel and I could not create an invite link. Give the bot the "Invite users via link" admin right, or send the invite link together with the ID.');
    }
  }
  if (chat.username) inviteLink = undefined;

  const existing = await Channel.findOne({ chatId: chat.chatId });
  await Channel.updateOne(
    { chatId: chat.chatId },
    { $set: { type: chat.type, title: chat.title, username: chat.username, inviteLink, addedBy: adminId } },
    { upsert: true },
  );
  invalidate();
  const channel = (await Channel.findOne({ chatId: chat.chatId }).lean()) as unknown as ChannelLean;
  return { channel, created: !existing, warning };
}

export async function removeChannel(ref: string | number): Promise<ChannelLean | null> {
  let doc;
  if (typeof ref === 'number' || /^-?\d+$/.test(String(ref))) {
    doc = await Channel.findOneAndDelete({ chatId: Number(ref) });
  } else {
    const uname = String(ref).replace(/^https?:\/\//i, '').replace(/^t\.me\//i, '').replace(/^@/, '');
    doc = await Channel.findOneAndDelete({ username: new RegExp(`^${uname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
  }
  invalidate();
  return doc ? (doc.toObject() as unknown as ChannelLean) : null;
}

// ---------------------------------------------------------------------------
//  Membership check (Telegram Bot API getChatMember)
// ---------------------------------------------------------------------------
const JOINED = new Set(['creator', 'administrator', 'member']);
const okCache = new Map<number, number>(); // userId -> time of last successful full check
const OK_TTL_MS = 10_000; // absorbs rapid button taps; anything older is re-verified against Telegram
const warned = new Map<number, number>();

async function isMember(tg: Telegram, c: ChannelLean, userId: number): Promise<boolean> {
  try {
    const m = await tg.getChatMember(c.chatId, userId);
    if (JOINED.has(m.status)) return true;
    // "restricted" users are still inside the channel when is_member is true
    return m.status === 'restricted' && (m as { is_member?: boolean }).is_member === true;
  } catch (e) {
    // Bot removed from the channel, channel deleted, Telegram hiccup, ...: never lock every user out
    // because of a broken channel. Fail open and tell the admins (at most once per 30 min per channel).
    logger.warn({ chatId: c.chatId, msg: (e as Error).message }, 'getChatMember failed');
    const last = warned.get(c.chatId) ?? 0;
    if (Date.now() - last > 30 * 60_000) {
      warned.set(c.chatId, Date.now());
      void notifyAdmins(tg, `⚠️ I cannot verify membership for <b>${c.title.replace(/[<>&]/g, '')}</b> (<code>${c.chatId}</code>). Is the bot still an admin there? Users are not blocked by this channel until it is fixed.`);
    }
    return true;
  }
}

/** Returns the required channels the user has NOT joined (empty = access allowed). */
export async function findMissingChannels(tg: Telegram, userId: number, channels: ChannelLean[], opts: { force?: boolean } = {}): Promise<ChannelLean[]> {
  if (!channels.length) return [];
  const seen = okCache.get(userId);
  if (!opts.force && seen && Date.now() - seen < OK_TTL_MS) return [];
  const results = await Promise.all(channels.map(async (c) => ((await isMember(tg, c, userId)) ? null : c)));
  const missing = results.filter((c): c is ChannelLean => c !== null);
  if (!missing.length) okCache.set(userId, Date.now());
  else okCache.delete(userId);
  return missing;
}
