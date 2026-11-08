import { Schema, model, Types } from 'mongoose';

export type TxType = 'deposit' | 'purchase' | 'refund' | 'admin_credit' | 'admin_debit';

export interface ITransaction {
  userId: Types.ObjectId;
  telegramId: number;
  type: TxType;
  /** signed minor units */
  amount: number;
  balanceAfter: number;
  refType?: 'order' | 'deposit';
  refId?: Types.ObjectId;
  note?: string;
  opKey?: string;
  createdAt: Date;
}

const schema = new Schema<ITransaction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    telegramId: { type: Number, required: true },
    type: { type: String, enum: ['deposit', 'purchase', 'refund', 'admin_credit', 'admin_debit'], required: true },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    refType: { type: String, enum: ['order', 'deposit'] },
    refId: Schema.Types.ObjectId,
    note: String,
    opKey: { type: String, unique: true, sparse: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
schema.index({ userId: 1, createdAt: -1 });
schema.index({ createdAt: -1 });

export const Transaction = model<ITransaction>('Transaction', schema);
