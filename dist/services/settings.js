"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadSettings = loadSettings;
exports.seedDefaults = seedDefaults;
exports.getCachedSettings = getCachedSettings;
exports.getSettings = getSettings;
exports.getSetting = getSetting;
exports.setSetting = setSetting;
exports.resetSetting = resetSetting;
const Setting_1 = require("../models/Setting");
const errors_1 = require("../utils/errors");
const TTL_MS = 10_000;
const DEF_BY_KEY = new Map(Setting_1.SETTING_DEFS.map((d) => [d.key, d]));
const clone = (v) => JSON.parse(JSON.stringify(v));
let cache = clone(Setting_1.SETTING_DEFAULTS);
let loadedAt = 0;
let inflight = null;
/** A stored value is only used if it has the same shape as the default; otherwise the default wins. */
function fits(key, value) {
    const def = Setting_1.SETTING_DEFAULTS[key];
    if (Array.isArray(def))
        return Array.isArray(value);
    if (typeof def === 'number')
        return typeof value === 'number' && Number.isFinite(value);
    if (typeof def !== typeof value)
        return false;
    const options = DEF_BY_KEY.get(key)?.options;
    return !options || options.includes(value);
}
async function loadSettings() {
    const docs = await Setting_1.Setting.find().lean();
    const next = clone(Setting_1.SETTING_DEFAULTS);
    for (const d of docs) {
        if (DEF_BY_KEY.has(d.key) && fits(d.key, d.value))
            next[d.key] = d.value;
    }
    cache = next;
    loadedAt = Date.now();
}
/** Inserts every missing setting with its default value (existing values are never touched). */
async function seedDefaults() {
    try {
        await Setting_1.Setting.bulkWrite(Setting_1.SETTING_DEFS.map((d) => ({
            updateOne: {
                filter: { key: d.key },
                update: { $setOnInsert: { key: d.key, value: Setting_1.SETTING_DEFAULTS[d.key] } },
                upsert: true,
            },
        })), { ordered: false });
    }
    catch (e) {
        if (!(0, errors_1.isDuplicateKeyError)(e))
            throw e;
    }
    await loadSettings();
}
/** Synchronous snapshot (used by formatters). Kept fresh by getSettings()/setSetting(). */
function getCachedSettings() {
    return cache;
}
async function getSettings() {
    if (Date.now() - loadedAt > TTL_MS) {
        inflight ??= loadSettings().finally(() => {
            inflight = null;
        });
        await inflight;
    }
    return cache;
}
async function getSetting(key) {
    return (await getSettings())[key];
}
async function setSetting(key, value) {
    await Setting_1.Setting.updateOne({ key }, { $set: { value } }, { upsert: true });
    cache = { ...cache, [key]: value };
}
async function resetSetting(key) {
    await setSetting(key, clone(Setting_1.SETTING_DEFAULTS[key]));
}
//# sourceMappingURL=settings.js.map