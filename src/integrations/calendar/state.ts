// The personal connect link: 15 minutes valid, signed for one user (BOUWPLAN.md, 11.8).
import { hmac, safeEqual } from '../../lib/secrets.js';

export const CONNECT_TTL_MS = 15 * 60 * 1000;
const PURPOSE = 'calendar-connect';

export function createConnectToken(userId: number, secret: string, now = new Date()): string {
  const body = Buffer.from(JSON.stringify({ u: userId, e: Math.floor((now.getTime() + CONNECT_TTL_MS) / 1000) })).toString('base64url');
  return `${body}.${hmac(secret, PURPOSE, body).toString('base64url')}`;
}

/** The user id, or undefined when the token is wrong or expired. */
export function verifyConnectToken(token: string, secret: string, now = new Date()): number | undefined {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return undefined;
  if (!safeEqual(signature, hmac(secret, PURPOSE, body).toString('base64url'))) return undefined;
  try {
    const { u, e } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { u?: unknown; e?: unknown };
    if (typeof u !== 'number' || typeof e !== 'number' || e * 1000 <= now.getTime()) return undefined;
    return u;
  } catch {
    return undefined;
  }
}
