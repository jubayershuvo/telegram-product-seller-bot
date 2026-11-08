import { Schema, model, Types, HydratedDocument } from 'mongoose';

export interface IOrder {
  userId: Types.ObjectId;
  telegramId: number;
  quantity: number;
  unitPrice: number;
  total: number;
  status: 'processing' | 'completed' | 'failed';
  failReason?: string;
  completedAt?: Date;
  createdAt: Date;
}
export type OrderDoc = HydratedDocument<IOrder>;

const schema = new Schema<IOrder>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    telegramId: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true },
    total: { type: Number, required: true },
    status: { type: String, enum: ['processing', 'completed', 'failed'], default: 'processing' },
    failReason: String,
    completedAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
schema.index({ userId: 1, createdAt: -1 });
schema.index({ status: 1, createdAt: 1 });

export const Order = model<IOrder>('Order', schema);
