import { createHash } from 'crypto';
import ExcelJS from 'exceljs';
import { parseCsv, toCsv } from '../lib/csv';
import { FileFormat } from '../models/Product';
import { AppError } from '../utils/errors';

const MAX_CELL = 2000;

export interface ParsedSheet {
  format: FileFormat;
  /** non-empty rows, every row padded to `width` */
  rows: string[][];
  width: number;
}

export function formatOf(fileName: string): FileFormat | null {
  const n = fileName.toLowerCase();
  if (n.endsWith('.xlsx')) return 'xlsx';
  if (n.endsWith('.csv')) return 'csv';
  return null;
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.replace('T', ' ').slice(0, 19);
  }
  if (typeof v === 'object') {
    const o = v as any;
    if (typeof o.text === 'string') return o.text; // hyperlink cell
    if (o.result !== undefined) return cellToString(o.result); // formula cell
    if (Array.isArray(o.richText)) return o.richText.map((r: any) => r.text).join('');
    if (o.error) return '';
  }
  return '';
}

/** trims cells, drops empty rows, works out the real width (last non-empty column) and pads every row to it */
function normalize(raw: string[][]): { rows: string[][]; width: number } {
  const rows = raw.map((r) => r.map((c) => c.trim().slice(0, MAX_CELL))).filter((r) => r.some((c) => c !== ''));
  let width = 0;
  for (const r of rows) {
    let last = r.length - 1;
    while (last >= 0 && r[last] === '') last--;
    width = Math.max(width, last + 1);
  }
  return { rows: rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? '')), width };
}

export async function parseDataFile(buffer: Buffer, fileName: string): Promise<ParsedSheet> {
  const format = formatOf(fileName);
  if (!format) throw new AppError('Please upload an .xlsx or .csv file.');

  let raw: string[][] = [];
  if (format === 'csv') {
    raw = parseCsv(buffer.toString('utf8'));
  } else {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new AppError('Could not read this file. Please upload a valid .xlsx file.');
    }
    const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
    if (!ws) throw new AppError('The workbook has no data.');
    // Use only cells that really exist (row.values is sparse). Looping over ws.columnCount for every row
    // can be 16k columns x thousands of rows when a sheet carries column formatting, which freezes the bot.
    const MAX_COLS = 200;
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (colNumber > MAX_COLS) return;
        cells[colNumber - 1] = cellToString(cell.value);
      });
      for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
      raw.push(cells);
    });
  }

  const { rows, width } = normalize(raw);
  if (rows.length === 0 || width === 0) throw new AppError('No data found in the file.');
  return { format, rows, width };
}

/** Column labels used when a file has no header row: A, B, … Z, AA … */
export function columnLabel(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Header names for a stored structure (empty header cells fall back to the column letter). */
export const headerNames = (firstRow: string[]): string[] => firstRow.map((c, i) => c || columnLabel(i));

export const normHeader = (s: string): string => s.trim().toLowerCase();

/** Stable per-row fingerprint used for the (productId, key) unique index. */
export const rowKey = (cells: string[]): string =>
  createHash('sha1').update(JSON.stringify(cells.map((c) => c.toLowerCase()))).digest('hex');

export interface DeliverySpec {
  columns: string[];
  hasHeader: boolean;
  format: FileFormat;
}

/** Builds the file the buyer receives: same header row / column count / format as the product's uploaded files. */
export async function buildDataFile(spec: DeliverySpec, rows: string[][]): Promise<Buffer> {
  if (spec.format === 'csv') {
    const all = spec.hasHeader ? [spec.columns, ...rows] : rows;
    return Buffer.from(`\uFEFF${toCsv(all)}`, 'utf8'); // BOM so Excel opens UTF-8 correctly
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  if (spec.hasHeader) ws.addRow(spec.columns).font = { bold: true };
  for (const r of rows) ws.addRow(r); // values are strings, so leading zeros / long numbers are preserved
  const all = spec.hasHeader ? [spec.columns, ...rows.slice(0, 200)] : rows.slice(0, 200);
  for (let c = 0; c < Math.max(spec.columns.length, 1); c++) {
    const longest = all.reduce((m, r) => Math.max(m, (r[c] ?? '').length), 8);
    ws.getColumn(c + 1).width = Math.min(60, longest + 2);
  }
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

export function deliveryFileName(productName: string, tag: string, qty: number, format: FileFormat): string {
  const slug = productName.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'order';
  return `${slug}_${tag}_${qty}.${format}`;
}
