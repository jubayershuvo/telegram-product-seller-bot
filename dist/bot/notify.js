"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyAdmins = notifyAdmins;
const env_1 = require("../config/env");
const logger_1 = require("../utils/logger");
async function notifyAdmins(telegram, html) {
    await Promise.all(env_1.env.ADMIN_IDS.map((id) => telegram.sendMessage(id, html, { parse_mode: 'HTML' }).catch((e) => logger_1.logger.warn({ id, msg: e.message }, 'Admin notify failed'))));
}
//# sourceMappingURL=notify.js.map