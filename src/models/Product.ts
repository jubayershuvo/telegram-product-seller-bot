import { Schema, model, HydratedDocument } from 'mongoose';

export type FileFormat = 'xlsx' | 'csv';

/**
 * A sellable product. Admins create it first, then upload data files (.xlsx / .csv) into it.
 * The first uploaded file defines the product's FILE STRUCTURE (number of columns, header row yes/no,
 * header names). Every later upload must match it, and buyers receive a file with exactly that structure.
 */
export interface IProduct {
  name: string;
  /** lower-cased name, used for the unique index */
  nameKey: string;
  description?: string;
  /** price per item (one data row), max 2 decimals */
  price: number;
  /** hidden products are not shown to buyers (but old orders keep working) */
  active: boolean;
  /** number of columns of the stored file structure (0 = not defined yet) */
  columnCount: number;
  /** header names (from the file's first row) or "A", "B", "C"… when the file has no header row */
  columns: string[];
  /** true = the file has a header row, and delivered files get the same header row */
  hasHeader: boolean;
  /** format of the delivered file */
  format: FileFormat;
  /** set on the product created from the old single-product `emails` collection */
  legacySource?: string;
  createdAt: Date;
  updatedAt: Date;
}
export type ProductDoc = HydratedDocument<IProduct>;

const schema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    nameKey: { type: String, required: true, unique: true },
    description: { type: String, trim: true, maxlength: 500 },
    price: { type: Number, required: true, min: 0 },
    active: { type: Boolean, default: true },
    columnCount: { type: Number, default: 0 },
    columns: { type: [String], default: [] },
    hasHeader: { type: Boolean, default: false },
    format: { type: String, enum: ['xlsx', 'csv'], default: 'xlsx' },
    legacySource: { type: String, index: true, sparse: true },
  },
  { timestamps: true },
);
schema.index({ active: 1, name: 1 });

export const Product = model<IProduct>('Product', schema);
