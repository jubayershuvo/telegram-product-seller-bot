import { Schema, model, HydratedDocument } from 'mongoose';

export interface IUser {
  telegramId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  /** minor units */
  balance: number;
  totalDeposited: number;
  totalSpent: number;
  isBanned: boolean;
  /** true after Telegram told us the user blocked the bot (reset on their next message) */
  botBlocked?: boolean;
  state?: { name?: string; data?: Record<string, any>; at?: Date };
  /** idempotency keys of wallet operations already applied (last 200) */
  ops: string[];
  lockUntil?: Date | null;
  lastSeenAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
export type UserDoc = HydratedDocument<IUser>;

const schema = new Schema<IUser>(
  {
    telegramId: { type: Number, required: true, unique: true, index: true },
    username: String,
    firstName: String,
    lastName: String,
    balance: { type: Number, default: 0, min: 0 },
    totalDeposited: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
    isBanned: { type: Boolean, default: false },
    botBlocked: { type: Boolean, default: false },
    state: {
      name: String,
      data: Schema.Types.Mixed,
      at: Date,
    },
    ops: { type: [String], default: [] },
    lockUntil: { type: Date, default: null },
    lastSeenAt: Date,
  },
  { timestamps: true },
);

export const User = model<IUser>('User', schema);
