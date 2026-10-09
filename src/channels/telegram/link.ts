// One-time link codes for the deeplink https://t.me/{bot}?start={code} (BOUWPLAN.md, 9.2).
// A code is valid for 30 minutes and only until the user links once after it was issued.
import { hmac, safeEqual } from '../../lib/secrets.js';

export const LINK_CODE_TTL_MS = 30 * 60 * 1000;
const PURPOSE = 'telegram-link';

/** Format: {userId base36}_{issuedAt seconds base36}_{signature hex}; fits Telegram's 64 chars. */
export function createLinkCode(userId: number, secret: string, now = new Date()): string {
  const issued = Math.floor(now.getTime() / 1000).toString(36);
  const payload = `${userId.toString(36)}_${issued}`;
  return `${payload}_${sign(secret, payload)}`;
}

export interface VerifiedLinkCode {
  userId: number;
  issuedAt: Date;
}

export function verifyLinkCode(
  code: string,
  secret: string,
  now = new Date(),
): VerifiedLinkCode | undefined {
  const match = /^([0-9a-z]+)_([0-9a-z]+)_([0-9a-f]{32})$/.exec(code);
  if (!match) return undefined;
  const [, user, issued, signature] = match as unknown as [string, string, string, string];
  if (!safeEqual(signature, sign(secret, `${user}_${issued}`))) return undefined;

  const issuedAt = new Date(parseInt(issued, 36) * 1000);
  const age = now.getTime() - issuedAt.getTime();
  if (age < -60_000 || age > LINK_CODE_TTL_MS) return undefined;

  return { userId: parseInt(user, 36), issuedAt };
}

export function deeplink(botUsername: string, code: string): string {
  return `https://t.me/${botUsername}?start=${code}`;
}

function sign(secret: string, payload: string): string {
  return hmac(secret, PURPOSE, payload).subarray(0, 16).toString('hex');
}
