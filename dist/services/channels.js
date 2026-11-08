"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.joinUrl = void 0;
exports.listChannels = listChannels;
exports.splitChannelInput = splitChannelInput;
exports.resolveChat = resolveChat;
exports.addChannel = addChannel;
exports.removeChannel = removeChannel;
exports.findMissingChannels = findMissingChannels;
const Channel_1 = require("../models/Channel");
const errors_1 = require("../utils/errors");
const logger_1 = require("../utils/logger");
const notify_1 = require("../bot/notify");
// ---------------------------------------------------------------------------
//  Required channel list (tiny in-memory cache, invalidated on every change)
// ---------------------------------------------------------------------------
let listCache = null;
const LIST_TTL_MS = 5_000;
async function listChannels() {
    if (listCache && Date.now() - listCache.at < LIST_TTL_MS)
        return listCache.list;
    const list = (await Channel_1.Channel.find().sort({ createdAt: 1 }).lean());
    listCache = { at: Date.now(), list };
    return list;
}
function invalidate() {
    listCache = null;
    okCache.clear();
}
const joinUrl = (c) => (c.username ? `https://t.me/${c.username}` : c.inviteLink || undefined);
exports.joinUrl = joinUrl;
// ---------------------------------------------------------------------------
//  Resolving what the admin typed / forwarded into a real chat
// ---------------------------------------------------------------------------
const INVITE_RE = /^(?:https?:\/\/)?t\.me\/(?:\+|joinchat\/)[\w-]+/i;
/** Splits "<channel> [invite link]" input into the channel reference and an optional invite link. */
function splitChannelInput(tokens) {
    let ref;
    let invite;
    for (const t of tokens) {
        if (INVITE_RE.test(t))
            invite = t.startsWith('http') ? t : `https://${t}`;
        else if (!ref)
            ref = t;
    }
    return { ref, invite };
}
function normalizeRef(raw) {
    let t = raw.trim();
    t = t.replace(/^https?:\/\//i, '').replace(/^t\.me\//i, '').replace(/^@/, '').replace(/\/+$/, '');
    if (/^-?\d+$/.test(t))
        return Number(t);
    if (!/^[A-Za-z][A-Za-z0-9_]{3,}$/.test(t))
        throw new errors_1.AppError('Send a channel as @username, a t.me/username link or its numeric ID (e.g. -1001234567890).');
    return `@${t}`;
}
async function resolveChat(tg, ref) {
    const target = typeof ref === 'number' ? ref : normalizeRef(ref);
    let chat;
    try {
        chat = await tg.getChat(target);
    }
    catch {
        throw new errors_1.AppError('Channel not found. Make sure the username/ID is right and the bot has been added to the channel as an admin.');
    }
    if (!['channel', 'supergroup', 'group'].includes(chat.type))
        throw new errors_1.AppError('That is not a channel or group.');
    return { chatId: chat.id, type: chat.type, title: chat.title ?? String(chat.id), username: chat.username, inviteLink: chat.invite_link };
}
/** The bot must be an admin of the channel, otherwise Telegram will not let it read the member list. */
async function assertBotIsAdmin(tg, chatId) {
    const me = await tg.getMe();
    try {
        const m = await tg.getChatMember(chatId, me.id);
        if (m.status !== 'administrator' && m.status !== 'creator')
            throw new Error('not admin');
    }
    catch {
        throw new errors_1.AppError('The bot must be an <b>administrator</b> of that channel to verify members. Add it as admin there, then try again.');
    }
}
async function addChannel(tg, adminId, input) {
    const { chat } = input;
    await assertBotIsAdmin(tg, chat.chatId);
    let inviteLink = input.inviteLink || undefined;
    let warning;
    if (!chat.username && !inviteLink) {
        // private channel: we need a link for the Join button
        try {
            const link = await tg.createChatInviteLink(chat.chatId, { name: 'Bot force-join' });
            inviteLink = link.invite_link;
        }
        catch {
            inviteLink = chat.inviteLink;
        }
        if (!inviteLink) {
            throw new errors_1.AppError('This is a private channel and I could not create an invite link. Give the bot the "Invite users via link" admin right, or send the invite link together with the ID.');
        }
    }
    if (chat.username)
        inviteLink = undefined;
    const existing = await Channel_1.Channel.findOne({ chatId: chat.chatId });
    await Channel_1.Channel.updateOne({ chatId: chat.chatId }, { $set: { type: chat.type, title: chat.title, username: chat.username, inviteLink, addedBy: adminId } }, { upsert: true });
    invalidate();
    const channel = (await Channel_1.Channel.findOne({ chatId: chat.chatId }).lean());
    return { channel, created: !existing, warning };
}
async function removeChannel(ref) {
    let doc;
    if (typeof ref === 'number' || /^-?\d+$/.test(String(ref))) {
        doc = await Channel_1.Channel.findOneAndDelete({ chatId: Number(ref) });
    }
    else {
        const uname = String(ref).replace(/^https?:\/\//i, '').replace(/^t\.me\//i, '').replace(/^@/, '');
        doc = await Channel_1.Channel.findOneAndDelete({ username: new RegExp(`^${uname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
    }
    invalidate();
    return doc ? doc.toObject() : null;
}
// ---------------------------------------------------------------------------
//  Membership check (Telegram Bot API getChatMember)
// ---------------------------------------------------------------------------
const JOINED = new Set(['creator', 'administrator', 'member']);
const okCache = new Map(); // userId -> time of last successful full check
const OK_TTL_MS = 10_000; // absorbs rapid button taps; anything older is re-verified against Telegram
const warned = new Map();
async function isMember(tg, c, userId) {
    try {
        const m = await tg.getChatMember(c.chatId, userId);
        if (JOINED.has(m.status))
            return true;
        // "restricted" users are still inside the channel when is_member is true
        return m.status === 'restricted' && m.is_member === true;
    }
    catch (e) {
        // Bot removed from the channel, channel deleted, Telegram hiccup, ...: never lock every user out
        // because of a broken channel. Fail open and tell the admins (at most once per 30 min per channel).
        logger_1.logger.warn({ chatId: c.chatId, msg: e.message }, 'getChatMember failed');
        const last = warned.get(c.chatId) ?? 0;
        if (Date.now() - last > 30 * 60_000) {
            warned.set(c.chatId, Date.now());
            void (0, notify_1.notifyAdmins)(tg, `⚠️ I cannot verify membership for <b>${c.title.replace(/[<>&]/g, '')}</b> (<code>${c.chatId}</code>). Is the bot still an admin there? Users are not blocked by this channel until it is fixed.`);
        }
        return true;
    }
}
/** Returns the required channels the user has NOT joined (empty = access allowed). */
async function findMissingChannels(tg, userId, channels, opts = {}) {
    if (!channels.length)
        return [];
    const seen = okCache.get(userId);
    if (!opts.force && seen && Date.now() - seen < OK_TTL_MS)
        return [];
    const results = await Promise.all(channels.map(async (c) => ((await isMember(tg, c, userId)) ? null : c)));
    const missing = results.filter((c) => c !== null);
    if (!missing.length)
        okCache.set(userId, Date.now());
    else
        okCache.delete(userId);
    return missing;
}
//# sourceMappingURL=channels.js.map