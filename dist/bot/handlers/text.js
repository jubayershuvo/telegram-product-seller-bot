"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTextRouter = registerTextRouter;
const shop_1 = require("./shop");
const admin_1 = require("./admin");
const adminPanel_1 = require("./adminPanel");
const recharge_1 = require("./recharge");
const channels_1 = require("./channels");
const products_1 = require("./products");
const ui_1 = require("../ui");
const STATE_TTL_MS = 30 * 60_000;
/** Routes free-text messages according to the conversation state persisted in MongoDB. */
function registerTextRouter(bot) {
    bot.on('text', async (ctx) => {
        const text = ctx.message.text.trim();
        if (text.startsWith('/'))
            return ctx.reply('Unknown command. Use the menu below or /help.', (0, ui_1.mainMenu)(ctx.isAdmin));
        const st = ctx.dbUser.state;
        const fresh = st?.name && st.at && Date.now() - new Date(st.at).getTime() < STATE_TTL_MS;
        if (!fresh) {
            if (st?.name)
                await (0, ui_1.clearState)(ctx.dbUser._id);
            return ctx.reply('Please use the menu below 👇', (0, ui_1.mainMenu)(ctx.isAdmin));
        }
        switch (st.name) {
            case 'awaiting_quantity':
                return (0, shop_1.handleQuantityInput)(ctx, text);
            case 'awaiting_trxid':
                return (0, recharge_1.handleTrxIdInput)(ctx, st.data?.method, text);
            case 'awaiting_balance_amount':
                return (0, adminPanel_1.handleBalanceAmountInput)(ctx, text);
            case 'awaiting_user_search':
                return (0, adminPanel_1.handleUserSearchInput)(ctx, text);
            case 'awaiting_recharge_hours':
                return (0, adminPanel_1.handleRechargeHoursInput)(ctx, text);
            case 'awaiting_product_name':
            case 'awaiting_product_price':
            case 'awaiting_product_desc':
            case 'awaiting_product_edit':
                return (0, products_1.handleProductInput)(ctx, st.name, text);
            case 'awaiting_product_file':
                return ctx.reply('📥 Please send the .xlsx or .csv <b>file</b> now (or /cancel).', { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
            case 'awaiting_product_pick':
            case 'awaiting_header_choice':
                return ctx.reply('👆 Please use the buttons above to continue (or /cancel).');
            case 'awaiting_channel':
                return (0, channels_1.handleChannelInput)(ctx, text);
            case 'awaiting_broadcast':
                // normally consumed by the broadcast listener; reaching here means the state is stale
                await (0, ui_1.clearState)(ctx.dbUser._id);
                return ctx.reply('Broadcast cancelled. Use /broadcast to start again.', (0, ui_1.mainMenu)(ctx.isAdmin));
            case 'awaiting_setting_value':
                return (0, admin_1.handleSettingValueInput)(ctx, Number(st.data?.idx), text);
            default:
                await (0, ui_1.clearState)(ctx.dbUser._id);
                return ctx.reply('Please use the menu below 👇', (0, ui_1.mainMenu)(ctx.isAdmin));
        }
    });
}
//# sourceMappingURL=text.js.map