"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rowKey = exports.normHeader = exports.headerNames = void 0;
exports.formatOf = formatOf;
exports.parseDataFile = parseDataFile;
exports.columnLabel = columnLabel;
exports.buildDataFile = buildDataFile;
exports.deliveryFileName = deliveryFileName;
const crypto_1 = require("crypto");
const exceljs_1 = __importDefault(require("exceljs"));
const csv_1 = require("../lib/csv");
const errors_1 = require("../utils/errors");
const MAX_CELL = 2000;
function formatOf(fileName) {
    const n = fileName.toLowerCase();
    if (n.endsWith('.xlsx'))
        return 'xlsx';
    if (n.endsWith('.csv'))
        return 'csv';
    return null;
}
function cellToString(v) {
    if (v === null || v === undefined)
        return '';
    if (typeof v === 'string')
        return v;
    if (typeof v === 'number' || typeof v === 'boolean')
        return String(v);
    if (v instanceof Date) {
        const iso = v.toISOString();
        return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.replace('T', ' ').slice(0, 19);
    }
    if (typeof v === 'object') {
        const o = v;
        if (typeof o.text === 'string')
            return o.text; // hyperlink cell
        if (o.result !== undefined)
            return cellToString(o.result); // formula cell
        if (Array.isArray(o.richText))
            return o.richText.map((r) => r.text).join('');
        if (o.error)
            return '';
    }
    return '';
}
/** trims cells, drops empty rows, works out the real width (last non-empty column) and pads every row to it */
function normalize(raw) {
    const rows = raw.map((r) => r.map((c) => c.trim().slice(0, MAX_CELL))).filter((r) => r.some((c) => c !== ''));
    let width = 0;
    for (const r of rows) {
        let last = r.length - 1;
        while (last >= 0 && r[last] === '')
            last--;
        width = Math.max(width, last + 1);
    }
    return { rows: rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? '')), width };
}
async function parseDataFile(buffer, fileName) {
    const format = formatOf(fileName);
    if (!format)
        throw new errors_1.AppError('Please upload an .xlsx or .csv file.');
    let raw = [];
    if (format === 'csv') {
        raw = (0, csv_1.parseCsv)(buffer.toString('utf8'));
    }
    else {
        const wb = new exceljs_1.default.Workbook();
        try {
            await wb.xlsx.load(buffer);
        }
        catch {
            throw new errors_1.AppError('Could not read this file. Please upload a valid .xlsx file.');
        }
        const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
        if (!ws)
            throw new errors_1.AppError('The workbook has no data.');
        const cols = ws.columnCount;
        ws.eachRow({ includeEmpty: false }, (row) => {
            const cells = [];
            for (let c = 1; c <= cols; c++)
                cells.push(cellToString(row.getCell(c).value));
            raw.push(cells);
        });
    }
    const { rows, width } = normalize(raw);
    if (rows.length === 0 || width === 0)
        throw new errors_1.AppError('No data found in the file.');
    return { format, rows, width };
}
/** Column labels used when a file has no header row: A, B, … Z, AA … */
function columnLabel(i) {
    let s = '';
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
        s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
}
/** Header names for a stored structure (empty header cells fall back to the column letter). */
const headerNames = (firstRow) => firstRow.map((c, i) => c || columnLabel(i));
exports.headerNames = headerNames;
const normHeader = (s) => s.trim().toLowerCase();
exports.normHeader = normHeader;
/** Stable per-row fingerprint used for the (productId, key) unique index. */
const rowKey = (cells) => (0, crypto_1.createHash)('sha1').update(JSON.stringify(cells.map((c) => c.toLowerCase()))).digest('hex');
exports.rowKey = rowKey;
/** Builds the file the buyer receives: same header row / column count / format as the product's uploaded files. */
async function buildDataFile(spec, rows) {
    if (spec.format === 'csv') {
        const all = spec.hasHeader ? [spec.columns, ...rows] : rows;
        return Buffer.from(`\uFEFF${(0, csv_1.toCsv)(all)}`, 'utf8'); // BOM so Excel opens UTF-8 correctly
    }
    const wb = new exceljs_1.default.Workbook();
    const ws = wb.addWorksheet('Data');
    if (spec.hasHeader)
        ws.addRow(spec.columns).font = { bold: true };
    for (const r of rows)
        ws.addRow(r); // values are strings, so leading zeros / long numbers are preserved
    const all = spec.hasHeader ? [spec.columns, ...rows.slice(0, 200)] : rows.slice(0, 200);
    for (let c = 0; c < Math.max(spec.columns.length, 1); c++) {
        const longest = all.reduce((m, r) => Math.max(m, (r[c] ?? '').length), 8);
        ws.getColumn(c + 1).width = Math.min(60, longest + 2);
    }
    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out);
}
function deliveryFileName(productName, tag, qty, format) {
    const slug = productName.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'order';
    return `${slug}_${tag}_${qty}.${format}`;
}
//# sourceMappingURL=dataFile.js.map