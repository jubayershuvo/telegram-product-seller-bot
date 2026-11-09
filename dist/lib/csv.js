"use strict";
/** Dependency-free CSV reader / writer (RFC 4180 quoting, auto-detects , ; or TAB, strips a UTF-8 BOM). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectDelimiter = detectDelimiter;
exports.parseCsv = parseCsv;
exports.toCsv = toCsv;
function detectDelimiter(text) {
    const first = text.split(/\r?\n/, 1)[0] ?? '';
    let best = ',';
    let bestCount = 0;
    for (const d of [',', ';', '\t']) {
        const n = first.split(d).length - 1;
        if (n > bestCount) {
            best = d;
            bestCount = n;
        }
    }
    return best;
}
function parseCsv(input) {
    const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
    const delim = detectDelimiter(text);
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                }
                else
                    inQuotes = false;
            }
            else
                field += c;
            continue;
        }
        if (c === '"' && field === '')
            inQuotes = true;
        else if (c === delim) {
            row.push(field);
            field = '';
        }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n')
                i++;
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        }
        else
            field += c;
    }
    if (field !== '' || row.length) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}
const needsQuotes = /[",\r\n;\t]|^\s|\s$/;
function toCsv(rows) {
    return rows.map((r) => r.map((c) => (needsQuotes.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n');
}
//# sourceMappingURL=csv.js.map