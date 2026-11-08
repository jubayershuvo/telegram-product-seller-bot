import { Telegram } from 'telegraf';
import { Types } from 'mongoose';
import { User } from '../models/User';
import { Broadcast } from '../models/Broadcast';
import { logger } from '../utils/logger';

/**
 * Telegram allows roughly 30 messages/second to different users for a bot.
 * We stay below that: BATCH messages are sent concurrently and every batch takes at least BATCH_MS.
 * HTTP 429 answers (flood wait) pause the WHOLE broadcast for the time Telegram asks and the message is retried.
 */
const BATCH = 20;
const BATCH_MS = 1000;
const MAX_ATTEMPTS = 4;
const PROGRESS_EVERY_MS = 3000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface BroadcastSource {
  chatId: number;
  messageId: number;
}

export interface BroadcastStats {
  total: number;
  sent: number;
  failed: number;
  blocked: number;
  floodWaits: number;
  status: 'running' | 'completed' | 'cancelled' | 'interrupted';
  startedAt: number;
}

interface Job {
  id: string;
  adminId: number;
  stats: BroadcastStats;
  cancelled: boolean;
}

let current: Job | null = null;

export const isBroadcastRunning = () => current !== null;

/** Users who will receive the broadcast: everyone except banned users and users who blocked the bot. */
const audienceFilter = { isBanned: { $ne: true }, botBlocked: { $ne: true } };

export async function audienceInfo() {
  const [total, receivers, banned, blocked] = await Promise.all([
    User.countDocuments(),
    User.countDocuments(audienceFilter),
    User.countDocuments({ isBanned: true }),
    User.countDocuments({ botBlocked: true, isBanned: { $ne: true } }),
  ]);
  return { total, receivers, banned, blocked };
}

type Outcome = 'ok' | 'blocked' | 'failed';

async function sendOne(tg: Telegram, userId: number, src: BroadcastSource, job: Job, pause: { until: number }): Promise<Outcome> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const wait = pause.until - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      await tg.copyMessage(userId, src.chatId, src.messageId);
      return 'ok';
    } catch (e) {
      const res = (e as any)?.response ?? {};
      const code: number | undefined = res.error_code;
      const desc: string = String(res.description ?? (e as Error).message ?? '');
      if (code === 429) {
        const retryAfter = Number(res.parameters?.retry_after ?? 5);
        pause.until = Math.max(pause.until, Date.now() + (retryAfter + 1) * 1000);
        job.stats.floodWaits++;
        continue;
      }
      if (code === 403 || (code === 400 && /chat not found|user is deactivated|peer_id_invalid/i.test(desc))) return 'blocked';
      if (code !== undefined && code >= 500) {
        await sleep(1000 * attempt);
        continue;
      }
      if (code === undefined) {
        // network error
        await sleep(1000 * attempt);
        continue;
      }
      logger.warn({ userId, code, desc }, 'Broadcast send failed');
      return 'failed';
    }
  }
  return 'failed';
}

export interface StartArgs {
  telegram: Telegram;
  adminId: number;
  source: BroadcastSource;
  onProgress: (s: BroadcastStats) => Promise<void> | void;
  onDone: (s: BroadcastStats) => Promise<void> | void;
}

/** Starts a broadcast in the background. Returns false if one is already running. */
export async function startBroadcast(args: StartArgs): Promise<boolean> {
  if (current) return false;
  const total = await User.countDocuments(audienceFilter);
  const record = await Broadcast.create({ adminId: args.adminId, sourceChatId: args.source.chatId, sourceMessageId: args.source.messageId, total });
  const job: Job = {
    id: String(record._id),
    adminId: args.adminId,
    cancelled: false,
    stats: { total, sent: 0, failed: 0, blocked: 0, floodWaits: 0, status: 'running', startedAt: Date.now() },
  };
  current = job;
  void run(job, args, record._id).catch((e) => logger.error({ err: (e as Error).message }, 'Broadcast crashed'));
  return true;
}

export function cancelBroadcast(): boolean {
  if (!current) return false;
  current.cancelled = true;
  return true;
}

async function run(job: Job, args: StartArgs, recordId: Types.ObjectId): Promise<void> {
  const { telegram, source } = args;
  const s = job.stats;
  const pause = { until: 0 };
  const newlyBlocked: number[] = [];
  let lastProgress = 0;

  const flushBlocked = async () => {
    if (!newlyBlocked.length) return;
    const ids = newlyBlocked.splice(0);
    await User.updateMany({ telegramId: { $in: ids } }, { $set: { botBlocked: true } }).catch(() => undefined);
  };

  try {
    // every telegramId is unique in the users collection, so nobody can receive the message twice
    const cursor = User.find(audienceFilter).select('telegramId').sort({ _id: 1 }).lean().cursor();
    let batch: number[] = [];

    const flush = async () => {
      if (!batch.length) return;
      const started = Date.now();
      const ids = batch;
      batch = [];
      const outcomes = await Promise.all(ids.map((id) => sendOne(telegram, id, source, job, pause)));
      outcomes.forEach((o, i) => {
        if (o === 'ok') s.sent++;
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
      if (spent < BATCH_MS) await sleep(BATCH_MS - spent);
    };

    for await (const u of cursor) {
      if (job.cancelled) break;
      batch.push((u as unknown as { telegramId: number }).telegramId);
      if (batch.length >= BATCH) await flush();
    }
    if (!job.cancelled) await flush();
    s.status = job.cancelled ? 'cancelled' : 'completed';
  } catch (e) {
    logger.error({ err: (e as Error).message }, 'Broadcast interrupted');
    s.status = 'interrupted';
  } finally {
    await flushBlocked();
    await Broadcast.updateOne({ _id: recordId }, { $set: { sent: s.sent, failed: s.failed, blocked: s.blocked, status: s.status, finishedAt: new Date() } }).catch(() => undefined);
    current = null;
    await Promise.resolve(args.onDone({ ...s })).catch(() => undefined);
  }
}
