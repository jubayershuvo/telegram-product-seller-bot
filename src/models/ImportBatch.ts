import { Schema, model } from 'mongoose';

export interface IImportBatch {
  adminTelegramId: number;
  fileName: string;
  totalRows: number;
  invalidRows: number;
  duplicatesInFile: number;
  duplicatesInDb: number;
  inserted: number;
  createdAt: Date;
}

const schema = new Schema<IImportBatch>(
  {
    adminTelegramId: { type: Number, required: true },
    fileName: { type: String, required: true },
    totalRows: Number,
    invalidRows: Number,
    duplicatesInFile: Number,
    duplicatesInDb: Number,
    inserted: Number,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const ImportBatch = model<IImportBatch>('ImportBatch', schema);
