import axios, { AxiosRequestConfig } from 'axios';
import { env } from '../../config/env';
import { PAYMENT_API as P } from './config';
import { logger } from '../../utils/logger';
import { safeError } from '../../utils/errors';
import { toMinor } from '../../utils/money';
import { VerifyInput, VerifyResult, VerifierUnavailableError } from './types';
import { customVerify } from './customAdapter';

/** {{trxId}} {{method}} {{amount}} {{telegramId}} placeholders in any string of a JSON template */
function fill(tpl: unknown, vars: Record<string, string>, encode = false): unknown {
  if (typeof tpl === 'string') {
    return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => {
      const v = vars[k] ?? '';
      return encode ? encodeURIComponent(v) : v;
    });
  }
  if (Array.isArray(tpl)) return tpl.map((t) => fill(t, vars, encode));
  if (tpl && typeof tpl === 'object') {
    return Object.fromEntries(Object.entries(tpl as Record<string, unknown>).map(([k, v]) => [k, fill(v, vars, encode)]));
  }
  return tpl;
}

export function getPath(obj: unknown, path: string | undefined): unknown {
  if (!path) return undefined;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

const digits = (s: string) => s.replace(/\D/g, '');

function parseMoney(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) && n > 0 ? toMinor(n) : undefined;
}

const nonEmpty = (o: Record<string, unknown>): Record<string, unknown> | undefined => (Object.keys(o).length ? o : undefined);

export async function verifyPayment(input: VerifyInput): Promise<VerifyResult> {
  if (customVerify) return customVerify(input);

  if (P.mode === 'mock') {
    // DEV ONLY: never allowed in production
    if (env.NODE_ENV === 'production') throw new VerifierUnavailableError('mock payment mode is not allowed in production');
    return input.trxId.startsWith('TEST')
      ? { ok: true, amountMinor: input.amountMinor, raw: { mock: true } }
      : { ok: false, reason: 'mock: trxId must start with TEST', userMessage: 'Transaction not found.' };
  }

  if (!P.url) {
    logger.error('PAYMENT_API.url is not configured in src/services/payment/config.ts');
    throw new VerifierUnavailableError('payment api not configured');
  }

  const vars = {
    trxId: input.trxId,
    method: input.method,
    amount: String(input.amountMinor),
    telegramId: String(input.telegramId),
  };

  const headers: Record<string, string> = { ...(fill(nonEmpty(P.headers), vars) as Record<string, string> | undefined) };
  let params = fill(nonEmpty(P.query), vars) as Record<string, unknown> | undefined;
  let body = fill(nonEmpty(P.body), vars) as Record<string, unknown> | undefined;
  const cfg: AxiosRequestConfig = {
    url: fill(P.url, vars, true) as string,
    method: P.method,
    timeout: P.timeoutMs,
    maxContentLength: 1_000_000,
    validateStatus: () => true,
  };

  const v = P.authValue;
  switch (P.authType) {
    case 'bearer':
      if (v) headers['Authorization'] = `Bearer ${v}`;
      break;
    case 'header':
      if (v) headers[P.authName || 'X-API-Key'] = v;
      break;
    case 'query':
      if (v) params = { ...(params ?? {}), [P.authName || 'api_key']: v };
      break;
    case 'body':
      if (v) body = { ...(body ?? {}), [P.authName || 'api_key']: v };
      break;
    case 'basic': {
      const [username, ...rest] = (v ?? '').split(':');
      cfg.auth = { username, password: rest.join(':') };
      break;
    }
  }

  cfg.headers = headers;
  if (params) cfg.params = params;
  if (P.method !== 'GET' && body) {
    if (P.bodyFormat === 'form') {
      cfg.data = new URLSearchParams(Object.fromEntries(Object.entries(body).map(([k, val]) => [k, String(val)])));
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else {
      cfg.data = body;
    }
  }

  let status: number;
  let data: unknown;
  try {
    const res = await axios.request(cfg);
    status = res.status;
    data = res.data;
  } catch (e) {
    logger.error({ err: safeError(e) }, 'Payment API request failed');
    throw new VerifierUnavailableError('payment api unreachable');
  }

  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      /* keep as string */
    }
  }

  if (status === 401 || status === 403) {
    logger.error({ status }, 'Payment API rejected our credentials');
    throw new VerifierUnavailableError('payment api auth error');
  }
  if (status === 404) return { ok: false, reason: 'not found (404)', userMessage: 'Transaction not found.', raw: data };
  if (status < 200 || status >= 300) {
    logger.error({ status }, 'Payment API returned an error status');
    throw new VerifierUnavailableError(`payment api http ${status}`);
  }

  const apiMessage = getPath(data, P.resp.messagePath);
  const fail = (reason: string, userMessage = 'Transaction could not be verified.'): VerifyResult => ({
    ok: false,
    reason: `${reason}${apiMessage ? ` | api: ${String(apiMessage).slice(0, 120)}` : ''}`,
    userMessage,
    raw: data,
  });

  // 1) success flag
  if (P.resp.successPath) {
    const flag = getPath(data, P.resp.successPath);
    if (flag === undefined || !P.resp.successValues.includes(String(flag).toLowerCase())) {
      return fail(`success flag "${String(flag)}"`, 'Transaction not found or not completed.');
    }
  }

  // 2) the API must echo the same TrxID (if configured)
  if (P.resp.trxIdPath) {
    const echoed = String(getPath(data, P.resp.trxIdPath) ?? '').trim().toUpperCase();
    if (echoed !== input.trxId) return fail('trxId mismatch in response');
  }

  // 3) receiver must be one of our numbers (if configured)
  if (P.expectedReceivers.length > 0) {
    const receiver = digits(String(getPath(data, P.resp.receiverPath) ?? ''));
    const ok = receiver.length >= 10 && P.expectedReceivers.some((n) => digits(n).slice(-10) === receiver.slice(-10));
    if (!ok) return fail('receiver mismatch', 'This payment was not sent to our number.');
  }

  const amountMinor = parseMoney(getPath(data, P.resp.amountPath));
  return { ok: true, amountMinor, raw: data };
}
