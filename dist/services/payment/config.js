"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAYMENT_API = void 0;
/**
 * Payment validation API: HARDCODED here (not stored in the database, not editable from Telegram).
 * Edit this file, rebuild and restart to change it.
 *
 * Placeholders usable in url / query / body / headers: {{trxId}} {{method}} {{amount}} {{telegramId}}
 * Response paths are dot paths, arrays as a.0.b
 */
exports.PAYMENT_API = {
    /** 'api' = call the validation API | 'mock' = DEV ONLY (TrxID starting with TEST is accepted; blocked in production) */
    mode: 'api',
    url: '',
    method: 'POST',
    /** none | bearer | header | query | body | basic */
    authType: 'none',
    /** header / query / body: the field name (e.g. X-API-Key, api_key). Not used for bearer / basic */
    authName: '',
    /** bearer token / api key / "user:pass" for basic */
    authValue: '',
    /** extra static headers, e.g. { 'X-Foo': 'bar' } */
    headers: {},
    /** query params, e.g. { trx: '{{trxId}}' } */
    query: {},
    /** request body (ignored for GET) */
    body: { trxId: '{{trxId}}', method: '{{method}}' },
    /** json | form */
    bodyFormat: 'json',
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
    expectedReceivers: [],
    /** true = verified amount must equal the amount the user selected */
    requireAmountMatch: false,
};
//# sourceMappingURL=config.js.map