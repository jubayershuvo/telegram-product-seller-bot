import { Telegram } from 'telegraf';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export async function notifyAdmins(telegram: Telegram, html: string): Promise<void> {
  await Promise.all(
    env.ADMIN_IDS.map((id) =>
      telegram.sendMessage(id, html, { parse_mode: 'HTML' }).catch((e) => logger.warn({ id, msg: (e as Error).message }, 'Admin notify failed')),
    ),
  );
}
