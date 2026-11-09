import { Schema, model, Types } from 'mongoose';

export interface IImportBatch {
  adminTelegramId: number;
  productId?: Types.ObjectId;
  productName?: string;
  fileName: string;
  totalRows: number;
  duplicatesInFile: number;
  duplicatesInDb: number;
  inserted: number;
  createdAt: Date;
}

const schema = new Schema<IImportBatch>(
  {
    adminTelegramId: { type: Number, required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', index: true },
    productName: String,
    fileName: { type: String, required: true },
    totalRows: Number,
    duplicatesInFile: Number,
    duplicatesInDb: Number,
    inserted: Number,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const ImportBatch = model<IImportBatch>('ImportBatch', schema);
