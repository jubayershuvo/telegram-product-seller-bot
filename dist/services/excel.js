"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseEmailColumn = parseEmailColumn;
exports.importEmails = importEmails;
exports.buildEmailWorkbook = buildEmailWorkbook;
const exceljs_1 = __importDefault(require("exceljs"));
const mongoose_1 = require("mongoose");
const Email_1 = require("../models/Email");
const ImportBatch_1 = require("../models/ImportBatch");
const errors_1 = require("../utils/errors");
const EMAIL_RE = /^[a-z0-9._%+\-']+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
const HEADER_WORDS = new Set(['email', 'emails', 'email address', 'e-mail', 'mail', 'address']);
function cellToString(v) {
    if (v === null || v === undefined)
        return '';
    if (typeof v === 'string')
        return v;
    if (typeof v === 'number' || typeof v === 'boolean')
        return String(v);
    if (typeof v === 'object') {
        const o = v;
        if (typeof o.text === 'string')
            return o.text; // hyperlink cell
        if (o.result !== undefined)
            return cellToString(o.result); // formula cell
        if (Array.isArray(o.richText))
            return o.richText.map((r) => r.text).join('');
    }
    return '';
}
/** Reads Column A of the first worksheet. */
async function parseEmailColumn(buffer) {
    const wb = new exceljs_1.default.Workbook();
    try {
        await wb.xlsx.load(buffer);
    }
    catch {
        throw new errors_1.AppError('Could not read this file. Please upload a valid .xlsx Excel file.');
    }
    const ws = wb.worksheets[0];
    if (!ws)
        throw new errors_1.AppError('The workbook has no worksheets.');
    const out = [];
    let first = true;
    ws.eachRow({ includeEmpty: false }, (row) => {
        const raw = cellToString(row.getCell(1).value).trim().replace(/^mailto:/i, '');
        if (first) {
            first = false;
            if (HEADER_WORDS.has(raw))
                return; // skip an optional header row
        }
        if (raw)
            out.push(raw);
    });
    return out;
}
async function importEmails(buffer, fileName, adminTelegramId) {
    const rows = await parseEmailColumn(buffer);
    if (rows.length === 0)
        throw new errors_1.AppError('No data found in Column A.');
    const seen = new Set();
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
    const batchId = new mongoose_1.Types.ObjectId();
    let inserted = 0;
    const CHUNK = 1000;
    for (let i = 0; i < unique.length; i += CHUNK) {
        const slice = unique.slice(i, i + CHUNK);
        // upsert with $setOnInsert: existing addresses are never touched (so a sold email can never become available again)
        const res = await Email_1.Email.bulkWrite(slice.map((address) => ({
            updateOne: {
                filter: { address },
                update: { $setOnInsert: { address, status: 'available', batchId } },
                upsert: true,
            },
        })), { ordered: false });
        inserted += res.upsertedCount;
    }
    const report = {
        totalRows: rows.length,
        invalidRows: invalid,
        duplicatesInFile: dupInFile,
        duplicatesInDb: unique.length - inserted,
        inserted,
    };
    await ImportBatch_1.ImportBatch.create({ _id: batchId, adminTelegramId, fileName, ...report });
    return report;
}
/** Excel file with ONLY the purchased emails in Column A (no header). */
async function buildEmailWorkbook(addresses) {
    const wb = new exceljs_1.default.Workbook();
    const ws = wb.addWorksheet('Emails');
    ws.getColumn(1).width = 42;
    for (const a of addresses)
        ws.addRow([a]);
    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out);
}
//# sourceMappingURL=excel.js.map