// Login links and sessions for the dashboard (step 2a.1). Tokens are random; only their
// SHA-256 hash is stored, so a database leak gives no working links or sessions.
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, gte, isNull, sql } from 'drizzle-orm';
import { recordEvent } from '../../core/events.js';
import type { Database } from '../../db/client.js';
import { loginTokens, webSessions } from '../../db/schema/index.js';

/** A login link works once and for 15 minutes. */
export const LOGIN_LINK_MINUTES = 15;
/** A session lasts 30 days and moves along with use. */
export const SESSION_DAYS = 30;
/** At most this many login links per user per quarter of an hour. */
export const MAX_LINKS_PER_WINDOW = 3;
/** Sliding sessions are refreshed at most once an hour. */
const TOUCH_AFTER_MS = 60 * 60_000;

export const SESSION_COOKIE = 'hf_session';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

/** A new one-time login token, or undefined when too many were asked for just now. */
export async function createLoginToken(db: Database, userId: number, channel: 'email' | 'telegram', now: Date): Promise<string | undefined> {
  const since = new Date(now.getTime() - LOGIN_LINK_MINUTES * 60_000);
  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginTokens)
    .where(and(eq(loginTokens.userId, userId), gte(loginTokens.createdAt, since)));
  if ((recent?.n ?? 0) >= MAX_LINKS_PER_WINDOW) return undefined;
  const token = newToken();
  await db.insert(loginTokens).values({
    userId,
    tokenHash: hashToken(token),
    channel,
    expiresAt: new Date(now.getTime() + LOGIN_LINK_MINUTES * 60_000),
    createdAt: now,
  });
  await recordEvent(db, userId, 'login_link_sent', { channel }, now);
  return token;
}

/** Uses a login token once; returns the user id when it was valid. */
export async function consumeLoginToken(db: Database, token: string, now: Date): Promise<number | undefined> {
  if (token.length < 20 || token.length > 100) return undefined;
  const [row] = await db
    .update(loginTokens)
    .set({ usedAt: now })
    .where(and(eq(loginTokens.tokenHash, hashToken(token)), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, now)))
    .returning({ userId: loginTokens.userId, channel: loginTokens.channel });
  if (!row) return undefined;
  await recordEvent(db, row.userId, 'login', { channel: row.channel }, now);
  return row.userId;
}

/** A login token that is still usable (for the confirm page). */
export async function isLoginTokenValid(db: Database, token: string, now: Date): Promise<boolean> {
  const [row] = await db
    .select({ id: loginTokens.id })
    .from(loginTokens)
    .where(and(eq(loginTokens.tokenHash, hashToken(token)), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, now)));
  return Boolean(row);
}

export async function createSession(db: Database, userId: number, now: Date): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  await db.insert(webSessions).values({ userId, tokenHash: hashToken(token), expiresAt, lastSeenAt: now });
  return { token, expiresAt };
}

/** The user of a session; extends it when it was last seen more than an hour ago. */
export async function sessionUser(db: Database, token: string, now: Date): Promise<{ userId: number; expiresAt: Date; refreshed: boolean } | undefined> {
  if (!token) return undefined;
  const [row] = await db.select().from(webSessions).where(and(eq(webSessions.tokenHash, hashToken(token)), gt(webSessions.expiresAt, now)));
  if (!row) return undefined;
  if (now.getTime() - row.lastSeenAt.getTime() < TOUCH_AFTER_MS) return { userId: row.userId, expiresAt: row.expiresAt, refreshed: false };
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  await db.update(webSessions).set({ lastSeenAt: now, expiresAt }).where(eq(webSessions.id, row.id));
  return { userId: row.userId, expiresAt, refreshed: true };
}

export async function deleteSession(db: Database, token: string): Promise<void> {
  await db.delete(webSessions).where(eq(webSessions.tokenHash, hashToken(token)));
}

/** Reads one cookie from the Cookie header. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

export function sessionCookie(token: string, expiresAt: Date, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function clearedCookie(secure: boolean): string {
  return [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT', ...(secure ? ['Secure'] : [])].join('; ');
}
