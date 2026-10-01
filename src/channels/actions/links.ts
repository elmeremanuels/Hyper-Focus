// Signed action links for buttons in mails: GET /a/{token} (BOUWPLAN.md, 9.3).
// The token holds the button id, the user, an expiry (7 days) and a nonce; it is
// signed with ACTION_LINK_SECRET. Single use is enforced by storing the nonce.
import crypto from 'node:crypto';
import { hmac, safeEqual } from '../../lib/secrets.js';

export const ACTION_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PURPOSE = 'action-link';

export interface ActionPayload {
  userId: number;
  buttonId: string;
  expiresAt: Date;
  nonce: string;
}

export function createActionToken(
  userId: number,
  buttonId: string,
  secret: string,
  now = new Date(),
): string {
  const body = Buffer.from(
    JSON.stringify({
      u: userId,
      b: buttonId,
      e: Math.floor((now.getTime() + ACTION_LINK_TTL_MS) / 1000),
      n: crypto.randomBytes(9).toString('base64url'),
    }),
  ).toString('base64url');
  return `${body}.${sign(secret, body)}`;
}

export type VerifyResult =
  | { ok: true; payload: ActionPayload }
  | { ok: false; reason: 'invalid' | 'expired' };

export function verifyActionToken(token: string, secret: string, now = new Date()): VerifyResult {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined || !safeEqual(signature, sign(secret, body))) {
    return { ok: false, reason: 'invalid' };
  }

  let decoded: { u?: unknown; b?: unknown; e?: unknown; n?: unknown };
  try {
    decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as typeof decoded;
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  const { u, b, e, n } = decoded;
  if (typeof u !== 'number' || typeof b !== 'string' || typeof e !== 'number' || typeof n !== 'string') {
    return { ok: false, reason: 'invalid' };
  }

  const expiresAt = new Date(e * 1000);
  if (expiresAt <= now) return { ok: false, reason: 'expired' };
  return { ok: true, payload: { userId: u, buttonId: b, expiresAt, nonce: n } };
}

export function actionUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, '')}/a/${token}`;
}

function sign(secret: string, body: string): string {
  return hmac(secret, PURPOSE, body).toString('base64url');
}
