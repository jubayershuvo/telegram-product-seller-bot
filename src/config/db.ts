import mongoose from 'mongoose';
import { env } from './env';
import { logger } from '../utils/logger';

export async function connectDb(): Promise<void> {
  mongoose.set('strictQuery', true);
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  mongoose.connection.on('error', (e) => logger.error({ msg: e.message }, 'MongoDB error'));

  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000, maxPoolSize: 20 });
  // Make sure unique indexes exist before accepting traffic (they protect against double sales / reused TrxIDs)
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  logger.info('MongoDB connected');
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
