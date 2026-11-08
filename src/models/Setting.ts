import { Schema, model } from 'mongoose';

/**
 * ALL runtime settings live here, in MongoDB.
 * - SETTING_DEFAULTS is the single source of truth for default values.
 * - On startup, any key missing from the DB is inserted with its default.
 * - Admins change values from Telegram with /settings, /set and /resetsetting.
 * - .env only keeps secrets / bootstrap values (BOT_TOKEN, MONGODB_URI, ADMIN_IDS, ...).
 *
 * Money values may have up to 2 decimals (e.g. 0.85, 4.4).
 * Payments are verified from synced SMS (src/lib/payment-verifier.ts, key SMSSYNC_API_KEY in .env).
 */
export interface SettingsShape {
  // ----- shop -----
  currencySymbol: string;
  timezone: string;
  /** price per email */
  price: number;
  /** max emails per order. 0 = no cap: the limit is simply what is in stock */
  maxQty: number;
  support: string;
  // ----- recharge -----
  /** master switch: admin can turn recharge on/off for everyone at any time */
  rechargeEnabled: boolean;
  /** when true, recharge is only open between rechargeOpenTime and rechargeCloseTime every day */
  rechargeScheduleEnabled: boolean;
  /** HH:mm in `timezone` */
  rechargeOpenTime: string;
  /** HH:mm in `timezone` (may be earlier than open time = overnight window) */
  rechargeCloseTime: string;
  bkashNumber: string;
  nagadNumber: string;
  minRecharge: number;
  maxRecharge: number;
  rechargePresets: number[];
  // ----- force join -----
  /** master switch: when true (and at least one channel is added) users must join every required channel */
  forceJoinEnabled: boolean;
  // ----- uploads -----
  maxUploadMb: number;
  // ----- TrxID rules -----
  trxIdRegex: string;
  maxFailedTrxPerHour: number;
}

export const SETTING_DEFAULTS: SettingsShape = {
  currencySymbol: '৳',
  timezone: 'Asia/Dhaka',
  price: 5,
  maxQty: 0,
  support: '',

  rechargeEnabled: true,
  rechargeScheduleEnabled: false,
  rechargeOpenTime: '09:00',
  rechargeCloseTime: '22:00',
  bkashNumber: '',
  nagadNumber: '',
  minRecharge: 50,
  maxRecharge: 10000,
  rechargePresets: [50, 100, 200, 500, 1000],

  forceJoinEnabled: true,

  maxUploadMb: 15,

  trxIdRegex: '^[A-Za-z0-9]{8,14}$',
  maxFailedTrxPerHour: 5,
};

export type SettingType =
  | 'string'
  | 'int' // whole number
  | 'money' // whole currency units
  | 'bool'
  | 'enum'
  | 'numlist' // comma separated numbers
  | 'strlist' // comma separated strings
  | 'json' // JSON object string (may be empty)
  | 'regex'
  | 'time' // HH:mm, 24h
  | 'timezone';

export interface SettingDef {
  key: keyof SettingsShape;
  type: SettingType;
  group: string;
  hint: string;
  /** hidden in /settings output and the /set message is deleted */
  secret?: boolean;
  options?: readonly string[];
  min?: number;
  max?: number;
}

export const SETTING_DEFS: SettingDef[] = [
  { key: 'currencySymbol', type: 'string', group: 'Shop', hint: 'e.g. ৳' },
  { key: 'timezone', type: 'timezone', group: 'Shop', hint: 'IANA name, e.g. Asia/Dhaka' },
  { key: 'price', type: 'money', group: 'Shop', hint: 'price per email' },
  { key: 'maxQty', type: 'int', group: 'Shop', hint: 'max emails per order, 0 = limited only by stock', min: 0, max: 10_000_000 },
  { key: 'support', type: 'string', group: 'Shop', hint: '@username or link' },

  { key: 'rechargeEnabled', type: 'bool', group: 'Recharge', hint: 'master switch: true = recharge open, false = closed for all users' },
  { key: 'rechargeScheduleEnabled', type: 'bool', group: 'Recharge', hint: 'true = recharge only open during the daily hours below' },
  { key: 'rechargeOpenTime', type: 'time', group: 'Recharge', hint: 'daily opening time, HH:mm (24h), e.g. 09:00' },
  { key: 'rechargeCloseTime', type: 'time', group: 'Recharge', hint: 'daily closing time, HH:mm (24h), e.g. 22:00' },
  { key: 'bkashNumber', type: 'string', group: 'Recharge', hint: 'bKash receiving number' },
  { key: 'nagadNumber', type: 'string', group: 'Recharge', hint: 'Nagad receiving number' },
  { key: 'minRecharge', type: 'money', group: 'Recharge', hint: 'minimum recharge' },
  { key: 'maxRecharge', type: 'money', group: 'Recharge', hint: 'maximum recharge' },
  { key: 'rechargePresets', type: 'numlist', group: 'Recharge', hint: 'quick amounts, e.g. 50,100,200' },

  { key: 'forceJoinEnabled', type: 'bool', group: 'Force Join', hint: 'true = users must join all required channels before using the bot' },

  { key: 'maxUploadMb', type: 'int', group: 'Uploads', hint: 'max .xlsx size in MB (Telegram limit 20)', min: 1, max: 20 },

  { key: 'trxIdRegex', type: 'regex', group: 'TrxID', hint: 'regular expression a TrxID must match' },
  { key: 'maxFailedTrxPerHour', type: 'int', group: 'TrxID', hint: 'failed attempts per user per hour', min: 1, max: 1000 },

];

export interface ISetting {
  key: string;
  value: unknown;
}

const schema = new Schema<ISetting>(
  {
    key: { type: String, required: true, unique: true },
    value: Schema.Types.Mixed,
  },
  { timestamps: true, minimize: false },
);

export const Setting = model<ISetting>('Setting', schema);
