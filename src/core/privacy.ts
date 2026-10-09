// "Exporteer mijn gegevens" and "verwijder mijn gegevens" (BOUWPLAN.md, 14 AVG).
import { eq, getTableColumns, getTableName } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { disconnectCalendars } from '../conversation/calendar.js';
import type { Database } from '../db/client.js';
import {
  aiUsage,
  businesses,
  calendarConnections,
  calendarEvents,
  clientChannels,
  clients,
  contentPosts,
  dailyFocus,
  dayReviews,
  events,
  focusBlocks,
  focusWindows,
  ideas,
  messages,
  projects,
  researchCache,
  rhythmProfiles,
  scheduledNudges,
  suggestions,
  tasks,
  users,
  userSettings,
  userTools,
} from '../db/schema/index.js';
import type { CalendarService } from '../integrations/calendar/service.js';
import { deleteUserMedia } from '../content/media.js';

/**
 * Everything stored for a user. Left out: login links and sessions (hashes only), the short-lived
 * conversation state, and encrypted calendar tokens and Buffer keys.
 */
const EXPORTED: PgTable[] = [
  userSettings,
  businesses,
  clients,
  clientChannels,
  contentPosts,
  projects,
  tasks,
  ideas,
  dailyFocus,
  userTools,
  focusBlocks,
  focusWindows,
  rhythmProfiles,
  dayReviews,
  suggestions,
  researchCache,
  messages,
  scheduledNudges,
  calendarConnections,
  calendarEvents,
  events,
  aiUsage,
];
const SECRET_COLUMNS = new Set(['accessTokenEnc', 'refreshTokenEnc', 'bufferApiKeyEnc']);

export async function exportUserData(db: Database, userId: number, now: Date) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return undefined;
  const data: Record<string, unknown[]> = {};
  for (const table of EXPORTED) {
    const columns = Object.fromEntries(Object.entries(getTableColumns(table)).filter(([key]) => !SECRET_COLUMNS.has(key)));
    const owner = (columns as Record<string, PgColumn>).userId;
    if (!owner) continue;
    data[getTableName(table)] = await db.select(columns).from(table).where(eq(owner, userId));
  }
  return { exportedAt: now.toISOString(), user, ...data };
}

/** Revokes calendar access and removes post photos, then deletes the user; every table cascades on the user. */
export async function deleteUserData(db: Database, userId: number, calendar: CalendarService | undefined, mediaDir?: string): Promise<boolean> {
  await disconnectCalendars(db, userId, calendar);
  if (mediaDir) await deleteUserMedia(db, userId, mediaDir);
  const deleted = await db.delete(users).where(eq(users.id, userId)).returning({ id: users.id });
  return deleted.length > 0;
}
