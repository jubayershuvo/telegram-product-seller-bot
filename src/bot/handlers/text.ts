import { Telegraf } from 'telegraf';
import { BotContext } from '../context';
import { handleQuantityInput } from './shop';
import { handleSettingValueInput } from './admin';
import { handleBalanceAmountInput, handleRechargeHoursInput, handleUserSearchInput } from './adminPanel';
import { handleTrxIdInput } from './recharge';
import { handleChannelInput } from './channels';
import { handleProductInput } from './products';
import { clearState, mainMenu } from '../ui';

const STATE_TTL_MS = 30 * 60_000;

/** Routes free-text messages according to the conversation state persisted in MongoDB. */
export function registerTextRouter(bot: Telegraf<BotContext>) {
  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return ctx.reply('Unknown command. Use the menu below or /help.', mainMenu(ctx.isAdmin));

    const st = ctx.dbUser.state;
    const fresh = st?.name && st.at && Date.now() - new Date(st.at).getTime() < STATE_TTL_MS;
    if (!fresh) {
      if (st?.name) await clearState(ctx.dbUser._id);
      return ctx.reply('Please use the menu below 👇', mainMenu(ctx.isAdmin));
    }

    switch (st.name) {
      case 'awaiting_quantity':
        return handleQuantityInput(ctx, text);
      case 'awaiting_trxid':
        return handleTrxIdInput(ctx, st.data?.method, text);
      case 'awaiting_balance_amount':
        return handleBalanceAmountInput(ctx, text);
      case 'awaiting_user_search':
        return handleUserSearchInput(ctx, text);
      case 'awaiting_recharge_hours':
        return handleRechargeHoursInput(ctx, text);
      case 'awaiting_product_name':
      case 'awaiting_product_price':
      case 'awaiting_product_desc':
      case 'awaiting_product_edit':
        return handleProductInput(ctx, st.name, text);
      case 'awaiting_product_file':
        return ctx.reply('📥 Please send the .xlsx or .csv <b>file</b> now (or /cancel).', { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
      case 'awaiting_product_pick':
      case 'awaiting_header_choice':
        return ctx.reply('👆 Please use the buttons above to continue (or /cancel).');
      case 'awaiting_channel':
        return handleChannelInput(ctx, text);
      case 'awaiting_broadcast':
        // normally consumed by the broadcast listener; reaching here means the state is stale
        await clearState(ctx.dbUser._id);
        return ctx.reply('Broadcast cancelled. Use /broadcast to start again.', mainMenu(ctx.isAdmin));
      case 'awaiting_setting_value':
        return handleSettingValueInput(ctx, Number(st.data?.idx), text);
      default:
        await clearState(ctx.dbUser._id);
        return ctx.reply('Please use the menu below 👇', mainMenu(ctx.isAdmin));
    }
  });
}
