import { Schema, model, Types } from 'mongoose';

export interface IEmail {
  address: string;
  status: 'available' | 'sold';
  soldTo?: Types.ObjectId;
  orderId?: Types.ObjectId;
  soldAt?: Date;
  batchId?: Types.ObjectId;
  createdAt: Date;
}

const schema = new Schema<IEmail>(
  {
    // unique index = an address can exist (and therefore be sold) only once
    address: { type: String, required: true, unique: true, trim: true },
    status: { type: String, enum: ['available', 'sold'], default: 'available' },
    soldTo: { type: Schema.Types.ObjectId, ref: 'User' },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    soldAt: Date,
    batchId: { type: Schema.Types.ObjectId, ref: 'ImportBatch' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
schema.index({ status: 1, _id: 1 });
schema.index({ orderId: 1 });
schema.index({ soldTo: 1 });

export const Email = model<IEmail>('Email', schema);
