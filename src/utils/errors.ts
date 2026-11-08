import axios from 'axios';

/** Error whose message is safe to show to the end user. */
export class AppError extends Error {
  constructor(message: string, public code: string = 'APP_ERROR') {
    super(message);
    this.name = 'AppError';
  }
}

export function isDuplicateKeyError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;
}

/** Never log raw axios errors: their config/URL can contain the bot token or API keys. */
export function safeError(e: unknown): Record<string, unknown> {
  if (axios.isAxiosError(e)) {
    return { message: e.message, code: e.code, status: e.response?.status };
  }
  if (e instanceof Error) return { name: e.name, message: e.message, stack: e.stack };
  return { message: String(e) };
}
