import ExcelJS from 'exceljs';
import { Types } from 'mongoose';
import { Email } from '../models/Email';
import { ImportBatch } from '../models/ImportBatch';
import { AppError } from '../utils/errors';

const EMAIL_RE = /^[a-z0-9._%+\-']+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
const HEADER_WORDS = new Set(['email', 'emails', 'email address', 'e-mail', 'mail', 'address']);

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    const o = v as any;
    if (typeof o.text === 'string') return o.text; // hyperlink cell
    if (o.result !== undefined) return cellToString(o.result); // formula cell
    if (Array.isArray(o.richText)) return o.richText.map((r: any) => r.text).join('');
  }
  return '';
}

export interface ImportReport {
  totalRows: number;
  invalidRows: number;
  duplicatesInFile: number;
  duplicatesInDb: number;
  inserted: number;
}

/** Reads Column A of the first worksheet. */
export async function parseEmailColumn(buffer: Buffer): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new AppError('Could not read this file. Please upload a valid .xlsx Excel file.');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new AppError('The workbook has no worksheets.');
  const out: string[] = [];
  let first = true;
  ws.eachRow({ includeEmpty: false }, (row) => {
    const raw = cellToString(row.getCell(1).value).trim().replace(/^mailto:/i, '');
    if (first) {
      first = false;
      if (HEADER_WORDS.has(raw)) return; // skip an optional header row
    }
    if (raw) out.push(raw);
  });
  return out;
}

export async function importEmails(buffer: Buffer, fileName: string, adminTelegramId: number): Promise<ImportReport> {
  const rows = await parseEmailColumn(buffer);
  if (rows.length === 0) throw new AppError('No data found in Column A.');

  const seen = new Set<string>();
  let invalid = 0;
  let dupInFile = 0;
  for (const r of rows) {
    const e = r;


    if (seen.has(e)) {
      dupInFile++;
      continue;
    }

    seen.add(e);
  }
  const unique = [...seen];
  const batchId = new Types.ObjectId();

  let inserted = 0;
  const CHUNK = 1000;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    // upsert with $setOnInsert: existing addresses are never touched (so a sold email can never become available again)
    const res = await Email.bulkWrite(
      slice.map((address) => ({
        updateOne: {
          filter: { address },
          update: { $setOnInsert: { address, status: 'available' as const, batchId } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    inserted += res.upsertedCount;
  }

  const report: ImportReport = {
    totalRows: rows.length,
    invalidRows: invalid,
    duplicatesInFile: dupInFile,
    duplicatesInDb: unique.length - inserted,
    inserted,
  };
  await ImportBatch.create({ _id: batchId, adminTelegramId, fileName, ...report });
  return report;
}

/** Excel file with ONLY the purchased emails in Column A (no header). */
export async function buildEmailWorkbook(addresses: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Emails');
  ws.getColumn(1).width = 42;
  for (const a of addresses) ws.addRow([a]);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
