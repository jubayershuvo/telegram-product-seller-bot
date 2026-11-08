import { Schema, model } from 'mongoose';

/** A channel / group users must join before they can use the bot. */
export interface IChannel {
  /** Telegram chat id (e.g. -1001234567890). Works for public and private channels. */
  chatId: number;
  type: string;
  title: string;
  /** public channels only (without @) */
  username?: string;
  /** invite link, used as the Join button for private channels */
  inviteLink?: string;
  addedBy?: number;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IChannel>(
  {
    chatId: { type: Number, required: true, unique: true, index: true },
    type: { type: String, default: 'channel' },
    title: { type: String, required: true },
    username: String,
    inviteLink: String,
    addedBy: Number,
  },
  { timestamps: true },
);

export const Channel = model<IChannel>('Channel', schema);
