import { getCachedSettings } from '../services/settings';

/** Money is stored in currency units with at most 2 decimals (e.g. 0.85, 4.4). */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
export const toMinor = round2;

/** price × quantity, rounded to 2 decimals (0.85 × 2 = 1.7). No floor / ceiling. */
export const lineTotal = (unitPrice: number, qty: number): number => round2(unitPrice * qty);

export function parseAmount(text: string): number | null {
  const t = text.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const minor = round2(Number(t));
  return minor > 0 ? minor : null;
}

export function fmt(minor: number): string {
  const major = minor;
  return `${getCachedSettings().currencySymbol}${Number.isInteger(major) ? major.toString() : major.toFixed(2)}`;
}

export function fmtSigned(minor: number): string {
  return `${minor >= 0 ? '+' : '-'}${fmt(Math.abs(minor))}`;
}

export function fmtDate(d: Date | undefined): string {
  if (!d) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: getCachedSettings().timezone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}
