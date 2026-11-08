import { Schema, model, Types, HydratedDocument } from 'mongoose';

export interface IDeposit {
  userId: Types.ObjectId;
  telegramId: number;
  method: 'bkash' | 'nagad';
  trxId: string;
  /** amount the user said they would pay (legacy; the credited amount always comes from the payment SMS) */
  claimedAmount: number;
  verifiedAmount?: number;
  status: 'processing' | 'verified' | 'failed';
  /** true while the TrxID is "owned" by this deposit (processing or verified) */
  locked: boolean;
  failReason?: string;
  rawResponse?: string;
  createdAt: Date;
}
export type DepositDoc = HydratedDocument<IDeposit>;

const schema = new Schema<IDeposit>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    telegramId: { type: Number, required: true },
    method: { type: String, enum: ['bkash', 'nagad'], required: true },
    trxId: { type: String, required: true, uppercase: true, trim: true },
    claimedAmount: { type: Number, default: 0 },
    verifiedAmount: Number,
    status: { type: String, enum: ['processing', 'verified', 'failed'], default: 'processing' },
    locked: { type: Boolean, default: true },
    failReason: String,
    rawResponse: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
// A TrxID can be used exactly once (failed attempts release the lock so a user can retry)
schema.index({ trxId: 1 }, { unique: true, partialFilterExpression: { locked: true } });
schema.index({ userId: 1, createdAt: -1 });
schema.index({ status: 1, createdAt: 1 });

export const Deposit = model<IDeposit>('Deposit', schema);
