import { getSettings, setSetting, SettingsShape } from './settings';

const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Current HH:mm minutes-since-midnight in the shop timezone. */
function nowMinutes(timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    return h * 60 + m;
  } catch {
    const d = new Date();
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
}

/** True when `now` is inside [open, close). Supports overnight windows (e.g. 22:00 → 06:00). */
export function inWindow(now: number, open: number, close: number): boolean {
  if (open === close) return true;
  return open < close ? now >= open && now < close : now >= open || now < close;
}

export interface RechargeStatus {
  open: boolean;
  /** why it is closed: 'admin' = master switch off, 'schedule' = outside daily hours */
  closedBy?: 'admin' | 'schedule';
  /** safe text to show users when closed */
  message?: string;
}

export function evaluate(s: SettingsShape): RechargeStatus {
  if (!s.rechargeEnabled) {
    return { open: false, closedBy: 'admin', message: '⛔ Recharge is currently closed. Please try again later.' };
  }
  if (s.rechargeScheduleEnabled && !inWindow(nowMinutes(s.timezone), toMin(s.rechargeOpenTime), toMin(s.rechargeCloseTime))) {
    return {
      open: false,
      closedBy: 'schedule',
      message: `⏰ Recharge is open daily from <b>${s.rechargeOpenTime}</b> to <b>${s.rechargeCloseTime}</b> (${s.timezone}). Please come back then.`,
    };
  }
  return { open: true };
}

export async function getRechargeStatus(): Promise<RechargeStatus> {
  return evaluate(await getSettings());
}

export async function setRechargeEnabled(on: boolean): Promise<void> {
  await setSetting('rechargeEnabled', on);
}

export async function setRechargeScheduleEnabled(on: boolean): Promise<void> {
  await setSetting('rechargeScheduleEnabled', on);
}

/** Sets the daily window and turns the schedule on. */
export async function setRechargeHours(open: string, close: string): Promise<void> {
  await setSetting('rechargeOpenTime', open);
  await setSetting('rechargeCloseTime', close);
  await setSetting('rechargeScheduleEnabled', true);
}

/** One-line status for the admin panel. */
export function describeRecharge(s: SettingsShape): string {
  const st = evaluate(s);
  const sched = s.rechargeScheduleEnabled ? `daily ${s.rechargeOpenTime}–${s.rechargeCloseTime}` : 'no schedule (always open when ON)';
  const state = st.open ? '🟢 OPEN' : st.closedBy === 'admin' ? '🔴 OFF (admin)' : '🟠 CLOSED (outside hours)';
  return `${state} • ${sched}`;
}
