import pino from 'pino';

const isProd = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: 'info',
  redact: ['*.token', '*.BOT_TOKEN', '*.authorization'],
  transport: isProd
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } },
});
