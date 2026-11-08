"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lineTotal = exports.toMinor = exports.round2 = void 0;
exports.parseAmount = parseAmount;
exports.fmt = fmt;
exports.fmtSigned = fmtSigned;
exports.fmtDate = fmtDate;
const settings_1 = require("../services/settings");
/** Money is stored in currency units with at most 2 decimals (e.g. 0.85, 4.4). */
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
exports.round2 = round2;
exports.toMinor = exports.round2;
/** price × quantity, rounded to 2 decimals (0.85 × 2 = 1.7). No floor / ceiling. */
const lineTotal = (unitPrice, qty) => (0, exports.round2)(unitPrice * qty);
exports.lineTotal = lineTotal;
function parseAmount(text) {
    const t = text.trim().replace(/,/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(t))
        return null;
    const minor = (0, exports.round2)(Number(t));
    return minor > 0 ? minor : null;
}
function fmt(minor) {
    const major = minor;
    return `${(0, settings_1.getCachedSettings)().currencySymbol}${Number.isInteger(major) ? major.toString() : major.toFixed(2)}`;
}
function fmtSigned(minor) {
    return `${minor >= 0 ? '+' : '-'}${fmt(Math.abs(minor))}`;
}
function fmtDate(d) {
    if (!d)
        return '-';
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: (0, settings_1.getCachedSettings)().timezone,
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(d);
}
//# sourceMappingURL=money.js.map