"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inWindow = inWindow;
exports.evaluate = evaluate;
exports.getRechargeStatus = getRechargeStatus;
exports.setRechargeEnabled = setRechargeEnabled;
exports.setRechargeScheduleEnabled = setRechargeScheduleEnabled;
exports.setRechargeHours = setRechargeHours;
exports.describeRecharge = describeRecharge;
const settings_1 = require("./settings");
const toMin = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
};
/** Current HH:mm minutes-since-midnight in the shop timezone. */
function nowMinutes(timezone) {
    try {
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
        const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
        const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
        return h * 60 + m;
    }
    catch {
        const d = new Date();
        return d.getUTCHours() * 60 + d.getUTCMinutes();
    }
}
/** True when `now` is inside [open, close). Supports overnight windows (e.g. 22:00 → 06:00). */
function inWindow(now, open, close) {
    if (open === close)
        return true;
    return open < close ? now >= open && now < close : now >= open || now < close;
}
function evaluate(s) {
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
async function getRechargeStatus() {
    return evaluate(await (0, settings_1.getSettings)());
}
async function setRechargeEnabled(on) {
    await (0, settings_1.setSetting)('rechargeEnabled', on);
}
async function setRechargeScheduleEnabled(on) {
    await (0, settings_1.setSetting)('rechargeScheduleEnabled', on);
}
/** Sets the daily window and turns the schedule on. */
async function setRechargeHours(open, close) {
    await (0, settings_1.setSetting)('rechargeOpenTime', open);
    await (0, settings_1.setSetting)('rechargeCloseTime', close);
    await (0, settings_1.setSetting)('rechargeScheduleEnabled', true);
}
/** One-line status for the admin panel. */
function describeRecharge(s) {
    const st = evaluate(s);
    const sched = s.rechargeScheduleEnabled ? `daily ${s.rechargeOpenTime}–${s.rechargeCloseTime}` : 'no schedule (always open when ON)';
    const state = st.open ? '🟢 OPEN' : st.closedBy === 'admin' ? '🔴 OFF (admin)' : '🟠 CLOSED (outside hours)';
    return `${state} • ${sched}`;
}
//# sourceMappingURL=rechargeGate.js.map