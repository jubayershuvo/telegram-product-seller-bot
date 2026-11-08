/**
 * Payment validation API: HARDCODED here (not stored in the database, not editable from Telegram).
 * Edit this file, rebuild and restart to change it.
 *
 * Placeholders usable in url / query / body / headers: {{trxId}} {{method}} {{amount}} {{telegramId}}
 * Response paths are dot paths, arrays as a.0.b
 */
export const PAYMENT_API = {
  /** 'api' = call the validation API | 'mock' = DEV ONLY (TrxID starting with TEST is accepted; blocked in production) */
  mode: 'api' as 'api' | 'mock',
  url: '',
  method: 'POST' as 'GET' | 'POST' | 'PUT',
  /** none | bearer | header | query | body | basic */
  authType: 'none' as 'none' | 'bearer' | 'header' | 'query' | 'body' | 'basic',
  /** header / query / body: the field name (e.g. X-API-Key, api_key). Not used for bearer / basic */
  authName: '',
  /** bearer token / api key / "user:pass" for basic */
  authValue: '',
  /** extra static headers, e.g. { 'X-Foo': 'bar' } */
  headers: {} as Record<string, unknown>,
  /** query params, e.g. { trx: '{{trxId}}' } */
  query: {} as Record<string, unknown>,
  /** request body (ignored for GET) */
  body: { trxId: '{{trxId}}', method: '{{method}}' } as Record<string, unknown>,
  /** json | form */
  bodyFormat: 'json' as 'json' | 'form',
  timeoutMs: 15000,

  resp: {
    /** if empty, any HTTP 2xx counts as success */
    successPath: 'status',
    successValues: ['true', 'success', 'completed', 'verified', 'paid', '1'],
    amountPath: 'amount',
    trxIdPath: '',
    receiverPath: '',
    messagePath: 'message',
  },

  /** only accept payments received by these numbers (needs resp.receiverPath) */
  expectedReceivers: [] as string[],
  /** true = verified amount must equal the amount the user selected */
  requireAmountMatch: false,
};
