"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isBroadcastRunning = void 0;
exports.sendBroadcastContent = sendBroadcastContent;
exports.audienceInfo = audienceInfo;
exports.startBroadcast = startBroadcast;
exports.cancelBroadcast = cancelBroadcast;
const User_1 = require("../models/User");
const Broadcast_1 = require("../models/Broadcast");
const logger_1 = require("../utils/logger");
/**
 * Telegram allows roughly 30 messages/second to different users for a bot.
 * We stay below that: BATCH messages are sent concurrently and every batch takes at least BATCH_MS.
 * HTTP 429 answers (flood wait) pause the WHOLE broadcast for the time Telegram asks and the message is retried.
 */
const BATCH = 20;
const BATCH_MS = 1000;
const MAX_ATTEMPTS = 4;
const PROGRESS_EVERY_MS = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Sends the broadcast content to one chat. Text goes out without a link preview; media is copied as it is. */
async function sendBroadcastContent(tg, toChatId, src) {
    if (src.text) {
        await tg.sendMessage(toChatId, src.text, {
            ...(src.entities?.length ? { entities: src.entities } : {}),
            link_preview_options: { is_disabled: true },
        });
        return;
    }
    await tg.copyMessage(toChatId, src.chatId, src.messageId);
}
let current = null;
const isBroadcastRunning = () => current !== null;
exports.isBroadcastRunning = isBroadcastRunning;
/** Users who will receive the broadcast: everyone except banned users and users who blocked the bot. */
const audienceFilter = { isBanned: { $ne: true }, botBlocked: { $ne: true } };
async function audienceInfo() {
    const [total, receivers, banned, blocked] = await Promise.all([
        User_1.User.countDocuments(),
        User_1.User.countDocuments(audienceFilter),
        User_1.User.countDocuments({ isBanned: true }),
        User_1.User.countDocuments({ botBlocked: true, isBanned: { $ne: true } }),
    ]);
    return { total, receivers, banned, blocked };
}
async function sendOne(tg, userId, src, job, pause) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const wait = pause.until - Date.now();
        if (wait > 0)
            await sleep(wait);
        try {
            await sendBroadcastContent(tg, userId, src);
            return 'ok';
        }
        catch (e) {
            const res = e?.response ?? {};
            const code = res.error_code;
            const desc = String(res.description ?? e.message ?? '');
            if (code === 429) {
                const retryAfter = Number(res.parameters?.retry_after ?? 5);
                pause.until = Math.max(pause.until, Date.now() + (retryAfter + 1) * 1000);
                job.stats.floodWaits++;
                continue;
            }
            if (code === 403 || (code === 400 && /chat not found|user is deactivated|peer_id_invalid/i.test(desc)))
                return 'blocked';
            if (code !== undefined && code >= 500) {
                await sleep(1000 * attempt);
                continue;
            }
            if (code === undefined) {
                // network error
                await sleep(1000 * attempt);
                continue;
            }
            logger_1.logger.warn({ userId, code, desc }, 'Broadcast send failed');
            return 'failed';
        }
    }
    return 'failed';
}
/** Starts a broadcast in the background. Returns false if one is already running. */
async function startBroadcast(args) {
    if (current)
        return false;
    const total = await User_1.User.countDocuments(audienceFilter);
    const record = await Broadcast_1.Broadcast.create({ adminId: args.adminId, sourceChatId: args.source.chatId, sourceMessageId: args.source.messageId, total });
    const job = {
        id: String(record._id),
        adminId: args.adminId,
        cancelled: false,
        stats: { total, sent: 0, failed: 0, blocked: 0, floodWaits: 0, status: 'running', startedAt: Date.now() },
    };
    current = job;
    void run(job, args, record._id).catch((e) => logger_1.logger.error({ err: e.message }, 'Broadcast crashed'));
    return true;
}
function cancelBroadcast() {
    if (!current)
        return false;
    current.cancelled = true;
    return true;
}
async function run(job, args, recordId) {
    const { telegram, source } = args;
    const s = job.stats;
    const pause = { until: 0 };
    const newlyBlocked = [];
    let lastProgress = 0;
    const flushBlocked = async () => {
        if (!newlyBlocked.length)
            return;
        const ids = newlyBlocked.splice(0);
        await User_1.User.updateMany({ telegramId: { $in: ids } }, { $set: { botBlocked: true } }).catch(() => undefined);
    };
    try {
        // every telegramId is unique in the users collection, so nobody can receive the message twice
        const cursor = User_1.User.find(audienceFilter).select('telegramId').sort({ _id: 1 }).lean().cursor();
        let batch = [];
        const flush = async () => {
            if (!batch.length)
                return;
            const started = Date.now();
            const ids = batch;
            batch = [];
            const outcomes = await Promise.all(ids.map((id) => sendOne(telegram, id, source, job, pause)));
            outcomes.forEach((o, i) => {
                if (o === 'ok')
                    s.sent++;
                else {
                    s.failed++;
                    if (o === 'blocked') {
                        s.blocked++;
                        newlyBlocked.push(ids[i]);
                    }
                }
            });
            await flushBlocked();
            if (Date.now() - lastProgress >= PROGRESS_EVERY_MS) {
                lastProgress = Date.now();
                await Promise.resolve(args.onProgress({ ...s })).catch(() => undefined);
            }
            const spent = Date.now() - started;
            if (spent < BATCH_MS)
                await sleep(BATCH_MS - spent);
        };
        for await (const u of cursor) {
            if (job.cancelled)
                break;
            batch.push(u.telegramId);
            if (batch.length >= BATCH)
                await flush();
        }
        if (!job.cancelled)
            await flush();
        s.status = job.cancelled ? 'cancelled' : 'completed';
    }
    catch (e) {
        logger_1.logger.error({ err: e.message }, 'Broadcast interrupted');
        s.status = 'interrupted';
    }
    finally {
        await flushBlocked();
        await Broadcast_1.Broadcast.updateOne({ _id: recordId }, { $set: { sent: s.sent, failed: s.failed, blocked: s.blocked, status: s.status, finishedAt: new Date() } }).catch(() => undefined);
        current = null;
        await Promise.resolve(args.onDone({ ...s })).catch(() => undefined);
    }
}
//# sourceMappingURL=broadcast.js.map