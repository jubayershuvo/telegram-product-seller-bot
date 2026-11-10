"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBotName = void 0;
exports.refreshBotName = refreshBotName;
const logger_1 = require("../utils/logger");
/**
 * The shop name is the bot's own name from @BotFather (the logo is the bot's profile picture, which Telegram
 * already shows beside that name). Nothing is stored: change the name or picture in @BotFather and the bot picks it up
 * within a few minutes - no restart, no settings.
 */
const FALLBACK = 'Digital Store';
const TTL_MS = 5 * 60_000;
let name = FALLBACK;
let loadedAt = 0;
let inflight = null;
/** Synchronous snapshot, kept fresh by refreshBotName(). */
const getBotName = () => name;
exports.getBotName = getBotName;
async function refreshBotName(telegram) {
    if (Date.now() - loadedAt < TTL_MS)
        return;
    inflight ??= telegram
        .getMe()
        .then((me) => {
        name = me.first_name?.trim() || FALLBACK;
        loadedAt = Date.now();
    })
        .catch((e) => {
        loadedAt = Date.now() - TTL_MS + 30_000; // retry in 30s
        logger_1.logger.warn({ err: e instanceof Error ? e.message : String(e) }, 'Could not read the bot name');
    })
        .finally(() => {
        inflight = null;
    });
    await inflight;
}
//# sourceMappingURL=botIdentity.js.map