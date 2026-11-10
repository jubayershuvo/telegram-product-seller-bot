"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSettingInput = parseSettingInput;
exports.crossCheck = crossCheck;
const money_1 = require("../utils/money");
const fail = (error) => ({ ok: false, error });
const EMPTY = new Set(['-', 'none', 'empty', 'null']);
/** Converts the text an admin typed into a validated value for the given setting. */
function parseSettingInput(def, raw) {
    const text = raw.trim();
    const empty = EMPTY.has(text.toLowerCase());
    switch (def.type) {
        case 'string':
            if (!empty && def.max !== undefined && text.length > def.max)
                return fail(`Maximum ${def.max} characters.`);
            return { ok: true, value: empty ? '' : text };
        case 'money': {
            const a = (0, money_1.parseAmount)(text);
            return a ? { ok: true, value: a } : fail('Send a valid amount greater than 0.');
        }
        case 'int': {
            if (!/^\d+$/.test(text))
                return fail('Send a whole number.');
            const n = parseInt(text, 10);
            if (def.min !== undefined && n < def.min)
                return fail(`Minimum is ${def.min}.`);
            if (def.max !== undefined && n > def.max)
                return fail(`Maximum is ${def.max}.`);
            return { ok: true, value: n };
        }
        case 'bool': {
            const t = text.toLowerCase();
            if (['1', 'true', 'yes', 'on'].includes(t))
                return { ok: true, value: true };
            if (['0', 'false', 'no', 'off'].includes(t))
                return { ok: true, value: false };
            return fail('Send true or false.');
        }
        case 'enum': {
            const hit = def.options?.find((o) => o.toLowerCase() === text.toLowerCase());
            return hit ? { ok: true, value: hit } : fail(`Allowed values: ${def.options?.join(', ')}`);
        }
        case 'numlist': {
            const nums = text.split(',').map((s) => s.trim()).filter(Boolean).map(Number);
            if (!nums.length || nums.some((n) => !Number.isFinite(n) || n <= 0))
                return fail('Send positive numbers separated by commas, e.g. 50,100,200');
            return { ok: true, value: nums };
        }
        case 'strlist': {
            if (empty)
                return { ok: true, value: [] };
            const items = text.split(',').map((s) => s.trim()).filter(Boolean);
            return { ok: true, value: items };
        }
        case 'json': {
            if (empty)
                return { ok: true, value: '' };
            try {
                const o = JSON.parse(text);
                if (typeof o !== 'object' || o === null || Array.isArray(o))
                    return fail('Must be a JSON object, e.g. {"a":"b"}');
            }
            catch {
                return fail('Invalid JSON.');
            }
            return { ok: true, value: text };
        }
        case 'regex':
            try {
                new RegExp(text, 'i');
            }
            catch {
                return fail('Invalid regular expression.');
            }
            return { ok: true, value: text };
        case 'time': {
            const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text);
            return m ? { ok: true, value: `${m[1].padStart(2, '0')}:${m[2]}` } : fail('Send a time as HH:mm (24h), e.g. 09:00');
        }
        case 'timezone':
            try {
                new Intl.DateTimeFormat('en-GB', { timeZone: text });
            }
            catch {
                return fail('Unknown timezone. Example: Asia/Dhaka');
            }
            return { ok: true, value: text };
    }
}
/** Cross-field checks that need the other current settings. */
function crossCheck(key, value, current) {
    if (key === 'minRecharge' && typeof value === 'number' && value > current.maxRecharge)
        return 'Minimum recharge cannot be above the maximum.';
    if (key === 'maxRecharge' && typeof value === 'number' && value < current.minRecharge)
        return 'Maximum recharge cannot be below the minimum.';
    if ((key === 'rechargeOpenTime' && value === current.rechargeCloseTime) || (key === 'rechargeCloseTime' && value === current.rechargeOpenTime)) {
        return 'Open and close time cannot be the same.';
    }
    return null;
}
//# sourceMappingURL=settingsParser.js.map