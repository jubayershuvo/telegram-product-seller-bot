import { Setting, SETTING_DEFAULTS, SETTING_DEFS, SettingsShape } from '../models/Setting';
import { isDuplicateKeyError } from '../utils/errors';

export type { SettingsShape };

const TTL_MS = 10_000;
const DEF_BY_KEY = new Map(SETTING_DEFS.map((d) => [d.key as string, d]));

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

let cache: SettingsShape = clone(SETTING_DEFAULTS);
let loadedAt = 0;
let inflight: Promise<void> | null = null;

/** A stored value is only used if it has the same shape as the default; otherwise the default wins. */
function fits(key: keyof SettingsShape, value: unknown): boolean {
  const def = SETTING_DEFAULTS[key];
  if (Array.isArray(def)) return Array.isArray(value);
  if (typeof def === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (typeof def !== typeof value) return false;
  const options = DEF_BY_KEY.get(key)?.options;
  return !options || options.includes(value as string);
}

export async function loadSettings(): Promise<void> {
  const docs = await Setting.find().lean();
  const next = clone(SETTING_DEFAULTS) as unknown as Record<string, unknown>;
  for (const d of docs) {
    if (DEF_BY_KEY.has(d.key) && fits(d.key as keyof SettingsShape, d.value)) next[d.key] = d.value;
  }
  cache = next as unknown as SettingsShape;
  loadedAt = Date.now();
}

/** Inserts every missing setting with its default value (existing values are never touched). */
export async function seedDefaults(): Promise<void> {
  try {
    await Setting.bulkWrite(
      SETTING_DEFS.map((d) => ({
        updateOne: {
          filter: { key: d.key },
          update: { $setOnInsert: { key: d.key, value: SETTING_DEFAULTS[d.key] } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  } catch (e) {
    if (!isDuplicateKeyError(e)) throw e;
  }
  await loadSettings();
}

/** Synchronous snapshot (used by formatters). Kept fresh by getSettings()/setSetting(). */
export function getCachedSettings(): SettingsShape {
  return cache;
}

export async function getSettings(): Promise<SettingsShape> {
  if (Date.now() - loadedAt > TTL_MS) {
    inflight ??= loadSettings().finally(() => {
      inflight = null;
    });
    await inflight;
  }
  return cache;
}

export async function getSetting<K extends keyof SettingsShape>(key: K): Promise<SettingsShape[K]> {
  return (await getSettings())[key];
}

export async function setSetting<K extends keyof SettingsShape>(key: K, value: SettingsShape[K]): Promise<void> {
  await Setting.updateOne({ key }, { $set: { value } }, { upsert: true });
  cache = { ...cache, [key]: value };
}

export async function resetSetting(key: keyof SettingsShape): Promise<void> {
  await setSetting(key, clone(SETTING_DEFAULTS[key]) as never);
}
