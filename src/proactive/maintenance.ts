// Hourly upkeep in the worker (verbeterplan P0.1, BOUWPLAN.md 14): closes blocks that stayed
// open, and keeps the retention promises: messages and transcripts 30 days, calendar events
// only from yesterday on, events and AI usage 12 months, expired login links and sessions.
import { and, eq, isNull, lt, ne } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { aiUsage, calendarEvents, events, focusBlocks, loginTokens, messages, scheduledNudges, webSessions } from '../db/schema/index.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** A block still open this long after its planned end is closed as expired. */
export const STALE_BLOCK_HOURS = 12;
export const MESSAGE_DAYS = 30;
export const METADATA_DAYS = 365;

export interface MaintenanceResult {
  expiredBlocks: number;
  messages: number;
  calendarEvents: number;
  metadata: number;
  logins: number;
}

export async function runMaintenance(db: Database, now: Date): Promise<MaintenanceResult> {
  const before = (ms: number) => new Date(now.getTime() - ms);
  const count = (rows: unknown[]) => rows.length;

  const expiredBlocks = count(
    await db
      .update(focusBlocks)
      .set({ outcome: 'expired', endedAt: focusBlocks.endsAt })
      .where(and(isNull(focusBlocks.endedAt), lt(focusBlocks.endsAt, before(STALE_BLOCK_HOURS * HOUR_MS))))
      .returning({ id: focusBlocks.id }),
  );
  const oldMessages =
    count(await db.delete(messages).where(lt(messages.createdAt, before(MESSAGE_DAYS * DAY_MS))).returning({ id: messages.id })) +
    // A queued message carries its text: gone a day after it was handled (verbeterplan P0.2).
    count(
      await db
        .delete(scheduledNudges)
        .where(and(eq(scheduledNudges.kind, 'ai_retry'), ne(scheduledNudges.status, 'pending'), lt(scheduledNudges.updatedAt, before(DAY_MS))))
        .returning({ id: scheduledNudges.id }),
    );
  // Only today and tomorrow are kept; a margin of a day covers every time zone.
  const oldEvents = count(await db.delete(calendarEvents).where(lt(calendarEvents.endsAtUtc, before(DAY_MS))).returning({ id: calendarEvents.id }));
  const metadata =
    count(await db.delete(events).where(lt(events.createdAt, before(METADATA_DAYS * DAY_MS))).returning({ id: events.id })) +
    count(await db.delete(aiUsage).where(lt(aiUsage.createdAt, before(METADATA_DAYS * DAY_MS))).returning({ id: aiUsage.id }));
  const logins =
    count(await db.delete(loginTokens).where(lt(loginTokens.expiresAt, before(DAY_MS))).returning({ id: loginTokens.id })) +
    count(await db.delete(webSessions).where(lt(webSessions.expiresAt, now)).returning({ id: webSessions.id }));

  return { expiredBlocks, messages: oldMessages, calendarEvents: oldEvents, metadata, logins };
}
