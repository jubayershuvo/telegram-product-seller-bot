"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleTrxIdInput = handleTrxIdInput;
exports.registerRechargeHandlers = registerRechargeHandlers;
const telegraf_1 = require("telegraf");
const ui_1 = require("../ui");
const settings_1 = require("../../services/settings");
const deposit_1 = require("../../services/deposit");
const rechargeGate_1 = require("../../services/rechargeGate");
const userLock_1 = require("../../services/userLock");
const errors_1 = require("../../utils/errors");
const money_1 = require("../../utils/money");
const logger_1 = require("../../utils/logger");
const notify_1 = require("../notify");
const label = (m) => (m === 'bkash' ? 'bKash' : 'Nagad');
const isMethod = (m) => m === 'bkash' || m === 'nagad';
/** Replies with the "closed" message (and clears any half-finished recharge). Returns true when closed. */
async function closedGuard(ctx) {
    const st = await (0, rechargeGate_1.getRechargeStatus)();
    if (st.open)
        return false;
    await (0, ui_1.clearState)(ctx.dbUser._id);
    await (0, ui_1.editOrReply)(ctx, st.message ?? 'Recharge is closed.', telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('🔄 Check again', 'rc:start')]]));
    return true;
}
// Step 1: select provider
async function startRecharge(ctx) {
    await (0, ui_1.clearState)(ctx.dbUser._id);
    if (await closedGuard(ctx))
        return;
    const s = await (0, settings_1.getSettings)();
    const rows = [];
    if (s.bkashNumber)
        rows.push(telegraf_1.Markup.button.callback('bKash', 'rc:m:bkash'));
    if (s.nagadNumber)
        rows.push(telegraf_1.Markup.button.callback('Nagad', 'rc:m:nagad'));
    if (!rows.length)
        return (0, ui_1.editOrReply)(ctx, '⚠️ Recharge is not available yet. Please contact support.');
    await (0, ui_1.editOrReply)(ctx, `➕ <b>Recharge wallet</b>\n\nSelect your payment provider.\nMin ${(0, money_1.fmt)(s.minRecharge)} • Max ${(0, money_1.fmt)(s.maxRecharge)}`, telegraf_1.Markup.inlineKeyboard([rows, [telegraf_1.Markup.button.callback('✖️ Cancel', 'x:cancel')]]));
}
// Step 2: show where to pay, then wait for the TrxID
async function showInstructions(ctx, method) {
    if (await closedGuard(ctx))
        return;
    const s = await (0, settings_1.getSettings)();
    const number = method === 'bkash' ? s.bkashNumber : s.nagadNumber;
    if (!number)
        return (0, ui_1.editOrReply)(ctx, 'This payment method is not available right now.');
    await (0, ui_1.setState)(ctx.dbUser._id, 'awaiting_trxid', { method });
    await (0, ui_1.editOrReply)(ctx, [
        `💳 <b>${label(method)} recharge</b>`,
        '',
        `1. Open the ${label(method)} app and choose <b>Send Money</b>`,
        `2. Number: <code>${(0, ui_1.esc)(number)}</code>`,
        `3. Amount: any amount from <b>${(0, money_1.fmt)(s.minRecharge)}</b> to <b>${(0, money_1.fmt)(s.maxRecharge)}</b>`,
        '4. Complete the payment and copy the <b>TrxID</b>',
        '5. <b>Send the TrxID here as a message</b> 👇',
        '',
        '⚠️ The wallet is credited with the amount you actually paid. Each TrxID can be used only once. /cancel to stop.',
    ].join('\n'), telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('⬅️ Change provider', 'rc:start'), telegraf_1.Markup.button.callback('✖️ Cancel', 'x:cancel')]]));
}
// Step 3: user sent the TrxID -> success / reject
async function handleTrxIdInput(ctx, method, text) {
    if (!isMethod(method)) {
        await (0, ui_1.clearState)(ctx.dbUser._id);
        return ctx.reply('Please start again with ➕ Recharge.', (0, ui_1.mainMenu)(ctx.isAdmin));
    }
    const wait = await ctx.reply('🔎 Verifying your transaction…');
    try {
        const out = await (0, userLock_1.withUserLock)(ctx.dbUser._id, () => (0, deposit_1.submitDeposit)({ userId: ctx.dbUser._id, telegramId: ctx.from.id, method, rawTrxId: text }));
        await (0, ui_1.clearState)(ctx.dbUser._id);
        await ctx.reply(`✅ <b>Recharge successful!</b>\n\nProvider: <b>${label(method)}</b>\nAdded: <b>${(0, money_1.fmt)(out.credited)}</b>\nNew balance: <b>${(0, money_1.fmt)(out.balance)}</b>`, { ...ui_1.HTML, ...(0, ui_1.mainMenu)(ctx.isAdmin) });
        await (0, notify_1.notifyAdmins)(ctx.telegram, `💳 Deposit ${label(method)} ${(0, money_1.fmt)(out.credited)} • user <code>${ctx.from.id}</code>`);
    }
    catch (err) {
        if (err instanceof errors_1.AppError) {
            // rejected: tell the user why. Keep the step open (so they can resend a corrected TrxID) except when retrying is pointless.
            await ctx.reply(`${err.message}`, ui_1.HTML);
            if (['TRX_DUPLICATE', 'TOO_MANY', 'AMOUNT_LIMIT'].includes(err.code))
                await (0, ui_1.clearState)(ctx.dbUser._id);
        }
        else {
            logger_1.logger.error({ err: (0, errors_1.safeError)(err) }, 'Deposit failed');
            await ctx.reply('⚠️ Something went wrong while verifying. If money was deducted from your wallet app, contact support with your TrxID.');
        }
    }
    finally {
        await ctx.telegram.deleteMessage(wait.chat.id, wait.message_id).catch(() => undefined);
    }
}
function registerRechargeHandlers(bot) {
    bot.command('recharge', startRecharge);
    bot.hears(ui_1.BTN.recharge, startRecharge);
    bot.action('rc:start', async (ctx) => {
        await ctx.answerCbQuery();
        await startRecharge(ctx);
    });
    bot.action(/^rc:m:(bkash|nagad)$/, async (ctx) => {
        await ctx.answerCbQuery();
        await showInstructions(ctx, ctx.match[1]);
    });
}
//# sourceMappingURL=recharge.js.map