export interface VerifyInput {
  trxId: string;
  method: 'bkash' | 'nagad';
  /** amount the user claims, minor units */
  amountMinor: number;
  telegramId: number;
}

export interface VerifyResult {
  ok: boolean;
  /** verified amount, minor units (if the API returns it) */
  amountMinor?: number;
  receiver?: string;
  /** internal reason (stored on the deposit) */
  reason?: string;
  /** safe text to show the user */
  userMessage?: string;
  raw?: unknown;
}

/** Thrown when the validation service itself is unreachable/misconfigured (NOT when a TrxID is invalid). */
export class VerifierUnavailableError extends Error {}
