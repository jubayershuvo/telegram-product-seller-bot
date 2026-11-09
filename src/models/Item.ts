import { Schema, model, Types } from 'mongoose';

/** One sellable unit = one data row of an uploaded file, stored as the list of its cell values. */
export interface IItem {
  productId: Types.ObjectId;
  /** hash of the normalised row; (productId, key) is unique so a row can exist (and be sold) only once per product */
  key: string;
  cells: string[];
  status: 'available' | 'sold';
  soldTo?: Types.ObjectId;
  orderId?: Types.ObjectId;
  soldAt?: Date;
  batchId?: Types.ObjectId;
  createdAt: Date;
}

const schema = new Schema<IItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    key: { type: String, required: true },
    cells: { type: [String], default: [] },
    status: { type: String, enum: ['available', 'sold'], default: 'available' },
    soldTo: { type: Schema.Types.ObjectId, ref: 'User' },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    soldAt: Date,
    batchId: { type: Schema.Types.ObjectId, ref: 'ImportBatch' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
schema.index({ productId: 1, key: 1 }, { unique: true });
schema.index({ productId: 1, status: 1, _id: 1 });
schema.index({ orderId: 1 });
schema.index({ soldTo: 1 });

export const Item = model<IItem>('Item', schema);
