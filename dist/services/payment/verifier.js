"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPath = getPath;
exports.verifyPayment = verifyPayment;
const axios_1 = __importDefault(require("axios"));
const env_1 = require("../../config/env");
const config_1 = require("./config");
const logger_1 = require("../../utils/logger");
const errors_1 = require("../../utils/errors");
const money_1 = require("../../utils/money");
const types_1 = require("./types");
const customAdapter_1 = require("./customAdapter");
/** {{trxId}} {{method}} {{amount}} {{telegramId}} placeholders in any string of a JSON template */
function fill(tpl, vars, encode = false) {
    if (typeof tpl === 'string') {
        return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
            const v = vars[k] ?? '';
            return encode ? encodeURIComponent(v) : v;
        });
    }
    if (Array.isArray(tpl))
        return tpl.map((t) => fill(t, vars, encode));
    if (tpl && typeof tpl === 'object') {
        return Object.fromEntries(Object.entries(tpl).map(([k, v]) => [k, fill(v, vars, encode)]));
    }
    return tpl;
}
function getPath(obj, path) {
    if (!path)
        return undefined;
    return path.split('.').reduce((acc, key) => {
        if (acc === null || acc === undefined)
            return undefined;
        return acc[key];
    }, obj);
}
const digits = (s) => s.replace(/\D/g, '');
function parseMoney(v) {
    if (v === undefined || v === null || v === '')
        return undefined;
    const n = Number(String(v).replace(/[^\d.\-]/g, ''));
    return Number.isFinite(n) && n > 0 ? (0, money_1.toMinor)(n) : undefined;
}
const nonEmpty = (o) => (Object.keys(o).length ? o : undefined);
async function verifyPayment(input) {
    if (customAdapter_1.customVerify)
        return (0, customAdapter_1.customVerify)(input);
    if (config_1.PAYMENT_API.mode === 'mock') {
        // DEV ONLY: never allowed in production
        if (env_1.env.NODE_ENV === 'production')
            throw new types_1.VerifierUnavailableError('mock payment mode is not allowed in production');
        return input.trxId.startsWith('TEST')
            ? { ok: true, amountMinor: input.amountMinor, raw: { mock: true } }
            : { ok: false, reason: 'mock: trxId must start with TEST', userMessage: 'Transaction not found.' };
    }
    if (!config_1.PAYMENT_API.url) {
        logger_1.logger.error('PAYMENT_API.url is not configured in src/services/payment/config.ts');
        throw new types_1.VerifierUnavailableError('payment api not configured');
    }
    const vars = {
        trxId: input.trxId,
        method: input.method,
        amount: String(input.amountMinor),
        telegramId: String(input.telegramId),
    };
    const headers = { ...fill(nonEmpty(config_1.PAYMENT_API.headers), vars) };
    let params = fill(nonEmpty(config_1.PAYMENT_API.query), vars);
    let body = fill(nonEmpty(config_1.PAYMENT_API.body), vars);
    const cfg = {
        url: fill(config_1.PAYMENT_API.url, vars, true),
        method: config_1.PAYMENT_API.method,
        timeout: config_1.PAYMENT_API.timeoutMs,
        maxContentLength: 1_000_000,
        validateStatus: () => true,
    };
    const v = config_1.PAYMENT_API.authValue;
    switch (config_1.PAYMENT_API.authType) {
        case 'bearer':
            if (v)
                headers['Authorization'] = `Bearer ${v}`;
            break;
        case 'header':
            if (v)
                headers[config_1.PAYMENT_API.authName || 'X-API-Key'] = v;
            break;
        case 'query':
            if (v)
                params = { ...(params ?? {}), [config_1.PAYMENT_API.authName || 'api_key']: v };
            break;
        case 'body':
            if (v)
                body = { ...(body ?? {}), [config_1.PAYMENT_API.authName || 'api_key']: v };
            break;
        case 'basic': {
            const [username, ...rest] = (v ?? '').split(':');
            cfg.auth = { username, password: rest.join(':') };
            break;
        }
    }
    cfg.headers = headers;
    if (params)
        cfg.params = params;
    if (config_1.PAYMENT_API.method !== 'GET' && body) {
        if (config_1.PAYMENT_API.bodyFormat === 'form') {
            cfg.data = new URLSearchParams(Object.fromEntries(Object.entries(body).map(([k, val]) => [k, String(val)])));
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }
        else {
            cfg.data = body;
        }
    }
    let status;
    let data;
    try {
        const res = await axios_1.default.request(cfg);
        status = res.status;
        data = res.data;
    }
    catch (e) {
        logger_1.logger.error({ err: (0, errors_1.safeError)(e) }, 'Payment API request failed');
        throw new types_1.VerifierUnavailableError('payment api unreachable');
    }
    if (typeof data === 'string') {
        try {
            data = JSON.parse(data);
        }
        catch {
            /* keep as string */
        }
    }
    if (status === 401 || status === 403) {
        logger_1.logger.error({ status }, 'Payment API rejected our credentials');
        throw new types_1.VerifierUnavailableError('payment api auth error');
    }
    if (status === 404)
        return { ok: false, reason: 'not found (404)', userMessage: 'Transaction not found.', raw: data };
    if (status < 200 || status >= 300) {
        logger_1.logger.error({ status }, 'Payment API returned an error status');
        throw new types_1.VerifierUnavailableError(`payment api http ${status}`);
    }
    const apiMessage = getPath(data, config_1.PAYMENT_API.resp.messagePath);
    const fail = (reason, userMessage = 'Transaction could not be verified.') => ({
        ok: false,
        reason: `${reason}${apiMessage ? ` | api: ${String(apiMessage).slice(0, 120)}` : ''}`,
        userMessage,
        raw: data,
    });
    // 1) success flag
    if (config_1.PAYMENT_API.resp.successPath) {
        const flag = getPath(data, config_1.PAYMENT_API.resp.successPath);
        if (flag === undefined || !config_1.PAYMENT_API.resp.successValues.includes(String(flag).toLowerCase())) {
            return fail(`success flag "${String(flag)}"`, 'Transaction not found or not completed.');
        }
    }
    // 2) the API must echo the same TrxID (if configured)
    if (config_1.PAYMENT_API.resp.trxIdPath) {
        const echoed = String(getPath(data, config_1.PAYMENT_API.resp.trxIdPath) ?? '').trim().toUpperCase();
        if (echoed !== input.trxId)
            return fail('trxId mismatch in response');
    }
    // 3) receiver must be one of our numbers (if configured)
    if (config_1.PAYMENT_API.expectedReceivers.length > 0) {
        const receiver = digits(String(getPath(data, config_1.PAYMENT_API.resp.receiverPath) ?? ''));
        const ok = receiver.length >= 10 && config_1.PAYMENT_API.expectedReceivers.some((n) => digits(n).slice(-10) === receiver.slice(-10));
        if (!ok)
            return fail('receiver mismatch', 'This payment was not sent to our number.');
    }
    const amountMinor = parseMoney(getPath(data, config_1.PAYMENT_API.resp.amountPath));
    return { ok: true, amountMinor, raw: data };
}
//# sourceMappingURL=verifier.js.map