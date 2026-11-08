import { Types } from 'mongoose';
import { User } from '../models/User';
import { AppError } from '../utils/errors';

/**
 * Per-user mutex stored in MongoDB (works across restarts and multiple processes).
 * Prevents a user double-tapping "Confirm" or submitting two TrxIDs at once.
 */
export async function withUserLock<T>(userId: Types.ObjectId, fn: () => Promise<T>, ttlMs = 60_000): Promise<T> {
  const now = new Date();
  const got = await User.findOneAndUpdate(
    { _id: userId, $or: [{ lockUntil: null }, { lockUntil: { $lt: now } }] },
    { $set: { lockUntil: new Date(now.getTime() + ttlMs) } },
  );
  if (!got) throw new AppError('⏳ Another request is still being processed. Please wait a moment.', 'LOCKED');
  try {
    return await fn();
  } finally {
    await User.updateOne({ _id: userId }, { $set: { lockUntil: null } }).catch(() => undefined);
  }
}
