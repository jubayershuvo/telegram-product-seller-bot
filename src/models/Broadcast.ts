import { Schema, model } from 'mongoose';

export interface IBroadcast {
  adminId: number;
  sourceChatId: number;
  sourceMessageId: number;
  total: number;
  sent: number;
  failed: number;
  /** subset of `failed`: users who blocked the bot / deleted their account */
  blocked: number;
  status: 'running' | 'completed' | 'cancelled' | 'interrupted';
  startedAt: Date;
  finishedAt?: Date;
}

const schema = new Schema<IBroadcast>(
  {
    adminId: { type: Number, required: true },
    sourceChatId: { type: Number, required: true },
    sourceMessageId: { type: Number, required: true },
    total: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    blocked: { type: Number, default: 0 },
    status: { type: String, enum: ['running', 'completed', 'cancelled', 'interrupted'], default: 'running' },
    startedAt: { type: Date, default: Date.now },
    finishedAt: Date,
  },
  { timestamps: true },
);

export const Broadcast = model<IBroadcast>('Broadcast', schema);
