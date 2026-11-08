import { Markup, Telegraf } from 'telegraf';
import { BotContext } from '../context';
import { BTN, HTML, clearState, editOrReply, esc, mainMenu, setState } from '../ui';
import { getSettings } from '../../services/settings';
import { submitDeposit } from '../../services/deposit';
import { getRechargeStatus } from '../../services/rechargeGate';
import { withUserLock } from '../../services/userLock';
import { AppError, safeError } from '../../utils/errors';
import { fmt } from '../../utils/money';
import { logger } from '../../utils/logger';
import { notifyAdmins } from '../notify';

type Method = 'bkash' | 'nagad';
const label = (m: Method) => (m === 'bkash' ? 'bKash' : 'Nagad');
const isMethod = (m: unknown): m is Method => m === 'bkash' || m === 'nagad';

/** Replies with the "closed" message (and clears any half-finished recharge). Returns true when closed. */
async function closedGuard(ctx: BotContext): Promise<boolean> {
  const st = await getRechargeStatus();
  if (st.open) return false;
  await clearState(ctx.dbUser._id);
  await editOrReply(ctx, st.message ?? 'Recharge is closed.', Markup.inlineKeyboard([[Markup.button.callback('🔄 Check again', 'rc:start')]]));
  return true;
}

// Step 1: select provider
async function startRecharge(ctx: BotContext) {
  await clearState(ctx.dbUser._id);
  if (await closedGuard(ctx)) return;
  const s = await getSettings();
  const rows = [];
  if (s.bkashNumber) rows.push(Markup.button.callback('bKash', 'rc:m:bkash'));
  if (s.nagadNumber) rows.push(Markup.button.callback('Nagad', 'rc:m:nagad'));
  if (!rows.length) return editOrReply(ctx, '⚠️ Recharge is not available yet. Please contact support.');
  await editOrReply(
    ctx,
    `➕ <b>Recharge wallet</b>\n\nSelect your payment provider.\nMin ${fmt(s.minRecharge)} • Max ${fmt(s.maxRecharge)}`,
    Markup.inlineKeyboard([rows, [Markup.button.callback('✖️ Cancel', 'x:cancel')]]),
  );
}

// Step 2: show where to pay, then wait for the TrxID
async function showInstructions(ctx: BotContext, method: Method) {
  if (await closedGuard(ctx)) return;
  const s = await getSettings();
  const number = method === 'bkash' ? s.bkashNumber : s.nagadNumber;
  if (!number) return editOrReply(ctx, 'This payment method is not available right now.');
  await setState(ctx.dbUser._id, 'awaiting_trxid', { method });
  await editOrReply(
    ctx,
    [
      `💳 <b>${label(method)} recharge</b>`,
      '',
      `1. Open the ${label(method)} app and choose <b>Send Money</b>`,
      `2. Number: <code>${esc(number)}</code>`,
      `3. Amount: any amount from <b>${fmt(s.minRecharge)}</b> to <b>${fmt(s.maxRecharge)}</b>`,
      '4. Complete the payment and copy the <b>TrxID</b>',
      '5. <b>Send the TrxID here as a message</b> 👇',
      '',
      '⚠️ The wallet is credited with the amount you actually paid. Each TrxID can be used only once. /cancel to stop.',
    ].join('\n'),
    Markup.inlineKeyboard([[Markup.button.callback('⬅️ Change provider', 'rc:start'), Markup.button.callback('✖️ Cancel', 'x:cancel')]]),
  );
}

// Step 3: user sent the TrxID -> success / reject
export async function handleTrxIdInput(ctx: BotContext, method: unknown, text: string) {
  if (!isMethod(method)) {
    await clearState(ctx.dbUser._id);
    return ctx.reply('Please start again with ➕ Recharge.', mainMenu(ctx.isAdmin));
  }
  const wait = await ctx.reply('🔎 Verifying your transaction…');
  try {
    const out = await withUserLock(ctx.dbUser._id, () =>
      submitDeposit({ userId: ctx.dbUser._id, telegramId: ctx.from!.id, method, rawTrxId: text }),
    );
    await clearState(ctx.dbUser._id);
    await ctx.reply(
      `✅ <b>Recharge successful!</b>\n\nProvider: <b>${label(method)}</b>\nAdded: <b>${fmt(out.credited)}</b>\nNew balance: <b>${fmt(out.balance)}</b>`,
      { ...HTML, ...mainMenu(ctx.isAdmin) },
    );
    await notifyAdmins(ctx.telegram, `💳 Deposit ${label(method)} ${fmt(out.credited)} • user <code>${ctx.from!.id}</code>`);
  } catch (err) {
    if (err instanceof AppError) {
      // rejected: tell the user why. Keep the step open (so they can resend a corrected TrxID) except when retrying is pointless.
      await ctx.reply(`${err.message}`, HTML);
      if (['TRX_DUPLICATE', 'TOO_MANY', 'AMOUNT_LIMIT'].includes(err.code)) await clearState(ctx.dbUser._id);
    } else {
      logger.error({ err: safeError(err) }, 'Deposit failed');
      await ctx.reply('⚠️ Something went wrong while verifying. If money was deducted from your wallet app, contact support with your TrxID.');
    }
  } finally {
    await ctx.telegram.deleteMessage(wait.chat.id, wait.message_id).catch(() => undefined);
  }
}

export function registerRechargeHandlers(bot: Telegraf<BotContext>) {
  bot.command('recharge', startRecharge);
  bot.hears(BTN.recharge, startRecharge);
  bot.action('rc:start', async (ctx) => {
    await ctx.answerCbQuery();
    await startRecharge(ctx);
  });
  bot.action(/^rc:m:(bkash|nagad)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await showInstructions(ctx, ctx.match[1] as Method);
  });
}
