import 'dotenv/config';
import { createHash } from 'crypto';
import { z } from 'zod';

/**
 * .env is intentionally tiny: only secrets and bootstrap values live here.
 * Every other setting (prices, payment numbers, payment API, limits, ...) is stored in MongoDB,
 * has its default in src/models/Setting.ts and is changed by admins from Telegram (/settings, /set).
 */
const optStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BOT_TOKEN: z.string().min(20, 'BOT_TOKEN is required'),
  // Bootstrap admins: must be known before the database is read, so they stay in .env
  ADMIN_IDS: z
    .string()
    .optional()
    .transform((v) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean).map(Number))
    .refine((a) => a.length > 0 && a.every((n) => Number.isInteger(n) && n > 0), {
      message: 'ADMIN_IDS must be comma separated numeric Telegram IDs',
    }),
  MONGODB_URI: z.string().min(10, 'MONGODB_URI is required'),
  // Optional: set a public domain to run in webhook mode. Leave empty for long polling.
  WEBHOOK_DOMAIN: optStr.transform((v) => v?.replace(/^https?:\/\//, '').replace(/\/+$/, '')),
  PORT: z.preprocess((v) => (v === '' || v === undefined ? undefined : v), z.coerce.number().int().positive().default(3000)),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    // eslint-disable-next-line no-console
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const base = parsed.data;

export const env = {
  ...base,
  BOT_MODE: (base.WEBHOOK_DOMAIN ? 'webhook' : 'polling') as 'webhook' | 'polling',
  WEBHOOK_PATH: '/telegram/webhook',
  // derived from the bot token, so no extra secret has to be kept in .env
  WEBHOOK_SECRET: createHash('sha256').update(`webhook:${base.BOT_TOKEN}`).digest('hex').slice(0, 48),
};
