// Validates Telegram Web App initData (core.telegram.org/bots/webapps, "Validating data
// received via the Mini App"): HMAC-SHA256 with the key HMAC("WebAppData", bot token).
import { createHmac } from 'node:crypto';
import { safeEqual } from '../../lib/secrets.js';

export const INIT_DATA_MAX_AGE_S = 24 * 60 * 60;

export interface WebAppUser {
  telegramUserId: number;
  authDate: Date;
}

export function validateInitData(initData: string, botToken: string, now = new Date()): WebAppUser | undefined {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return undefined;
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (!safeEqual(expected, hash)) return undefined;

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || now.getTime() / 1000 - authDate > INIT_DATA_MAX_AGE_S) return undefined;
  try {
    const user = JSON.parse(params.get('user') ?? '{}') as { id?: unknown };
    if (typeof user.id !== 'number') return undefined;
    return { telegramUserId: user.id, authDate: new Date(authDate * 1000) };
  } catch {
    return undefined;
  }
}

/** For tests: signs initData the way Telegram does. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}
