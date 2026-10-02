// Calendar connections with encrypted tokens (src/lib/crypto.ts, BOUWPLAN.md, 14).
import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { calendarConnections, calendarEvents, scheduledNudges, userSettings } from '../../db/schema/index.js';
import { decryptToken, encryptToken } from '../../lib/crypto.js';
import type { CalendarProviderName, Credentials } from './types.js';

export type ConnectionRow = typeof calendarConnections.$inferSelect;

const enc = (value: string | null | undefined, secret: string | undefined) => (value ? encryptToken(value, secret) : null);

/** Creates or replaces the user's connection for a provider and turns the calendar on. */
export async function saveConnection(
  db: Database,
  userId: number,
  provider: CalendarProviderName,
  credentials: Credentials,
  secret: string | undefined,
): Promise<number> {
  // Apple has no tokens: the Apple ID and app-specific password go encrypted in the refresh column.
  const refresh =
    provider === 'apple'
      ? JSON.stringify({ username: credentials.username, password: credentials.password })
      : credentials.refreshToken;
  const values = {
    accessTokenEnc: enc(credentials.accessToken, secret),
    refreshTokenEnc: enc(refresh, secret),
    tokenExpiresAt: credentials.expiresAt ?? null,
    calendarIds: credentials.calendars?.length ? credentials.calendars : ['primary'],
    status: 'active' as const,
    syncToken: null,
  };
  const [row] = await db
    .insert(calendarConnections)
    .values({ userId, provider, ...values })
    .onConflictDoUpdate({ target: [calendarConnections.userId, calendarConnections.provider], set: values })
    .returning({ id: calendarConnections.id });
  await db.update(userSettings).set({ calendarEnabled: true }).where(eq(userSettings.userId, userId));
  if (!row) throw new Error('Saving the calendar connection failed');
  return row.id;
}

/** Stores refreshed tokens; keeps what the refresh did not return. */
export async function updateTokens(db: Database, connectionId: number, refreshed: Credentials, secret: string | undefined) {
  await db
    .update(calendarConnections)
    .set({
      ...(refreshed.accessToken && { accessTokenEnc: enc(refreshed.accessToken, secret) }),
      ...(refreshed.refreshToken && { refreshTokenEnc: enc(refreshed.refreshToken, secret) }),
      ...(refreshed.expiresAt !== undefined && { tokenExpiresAt: refreshed.expiresAt }),
    })
    .where(eq(calendarConnections.id, connectionId));
}

export function credentialsOf(row: ConnectionRow, secret: string | undefined): Credentials {
  const refresh = row.refreshTokenEnc ? decryptToken(row.refreshTokenEnc, secret) : null;
  const calendars = row.calendarIds.filter((id) => id !== 'primary');
  if (row.provider === 'apple') {
    const { username, password } = JSON.parse(refresh ?? '{}') as { username?: string; password?: string };
    return { ...(username && { username }), ...(password && { password }), calendars };
  }
  return {
    accessToken: row.accessTokenEnc ? decryptToken(row.accessTokenEnc, secret) : null,
    refreshToken: refresh,
    expiresAt: row.tokenExpiresAt,
    calendars,
  };
}

export async function listConnections(db: Database, userId: number): Promise<ConnectionRow[]> {
  return db
    .select()
    .from(calendarConnections)
    .where(and(eq(calendarConnections.userId, userId), inArray(calendarConnections.status, ['active', 'error'])));
}

/** Deletes connections (events cascade), pending meeting messages and turns the calendar off. */
export async function deleteConnections(db: Database, userId: number) {
  await db.delete(calendarConnections).where(eq(calendarConnections.userId, userId));
  await db.delete(calendarEvents).where(eq(calendarEvents.userId, userId));
  await db
    .delete(scheduledNudges)
    .where(
      and(
        eq(scheduledNudges.userId, userId),
        eq(scheduledNudges.status, 'pending'),
        inArray(scheduledNudges.kind, ['meeting_heads_up', 'meeting_followup']),
      ),
    );
  await db.update(userSettings).set({ calendarEnabled: false }).where(eq(userSettings.userId, userId));
}
