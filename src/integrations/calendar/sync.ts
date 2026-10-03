// Fetches today and tomorrow, stores only the allowed fields, links appointments to
// clients and plans heads-ups and follow-ups (BOUWPLAN.md, 11.8).
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { Database } from '../../db/client.js';
import { calendarConnections, calendarEvents, clients, projects, scheduledNudges, userSettings } from '../../db/schema/index.js';
import { bestWordMatch } from '../../lib/match.js';
import { localDate } from '../../lib/time.js';
import type { DayEvent } from '../../proactive/daycalendar.js';
import { providerFor, type CalendarService } from './service.js';
import { credentialsOf, listConnections, updateTokens } from './store.js';

/** The worker refreshes connections older than this. */
export const SYNC_EVERY_MS = 15 * 60 * 1000;
export const HEADS_UP_MINUTES = 10;

export interface SyncResult {
  connected: boolean;
  ok: boolean;
}

/** Syncs all connections of a user. Failures mark the connection as error; planning goes on. */
export async function syncUserCalendars(
  db: Database,
  service: CalendarService,
  userId: number,
  timezone: string,
  now: Date,
  log: Pick<Console, 'error'> = console,
): Promise<SyncResult> {
  const connections = await listConnections(db, userId);
  if (connections.length === 0) return { connected: false, ok: true };

  const local = DateTime.fromJSDate(now, { zone: timezone }).startOf('day');
  const from = local.toUTC().toJSDate();
  const to = local.plus({ days: 2 }).toUTC().toJSDate();
  let ok = true;

  for (const connection of connections) {
    const provider = providerFor(service, connection.provider);
    try {
      if (!provider) throw new Error(`Provider ${connection.provider} is not configured`);
      const credentials = { ...credentialsOf(connection, service.encryptionKey), timezone };
      const { events, refreshed } = await provider.listEvents(credentials, from, to);
      if (refreshed) await updateTokens(db, connection.id, refreshed, service.encryptionKey);

      const [clientRows, projectRows] = await Promise.all([
        db.select({ id: clients.id, name: clients.name }).from(clients).where(and(eq(clients.userId, userId), eq(clients.status, 'active'))),
        db
          .select({ id: projects.id, clientId: projects.clientId, title: projects.title })
          .from(projects)
          .where(and(eq(projects.userId, userId), eq(projects.status, 'active'))),
      ]);

      await db.transaction(async (tx) => {
        // Only this window is kept; older appointments disappear here (BOUWPLAN.md, 14).
        await tx.delete(calendarEvents).where(eq(calendarEvents.connectionId, connection.id));
        const seen = new Set<string>();
        const rows = events
          .filter((e) => !seen.has(e.externalId) && seen.add(e.externalId))
          .map((e) => {
            const client = bestWordMatch(e.title, clientRows, (c) => c.name);
            const project = client ? projectRows.find((p) => p.clientId === client.id) : bestWordMatch(e.title, projectRows, (p) => p.title);
            return {
              userId,
              connectionId: connection.id,
              externalId: e.externalId,
              startsAtUtc: e.startsAt,
              endsAtUtc: e.endsAt,
              title: e.title.slice(0, 200),
              isBusy: e.isBusy,
              isAllDay: e.isAllDay,
              clientId: client?.id ?? project?.clientId ?? null,
              projectId: project?.id ?? null,
            };
          });
        if (rows.length > 0) await tx.insert(calendarEvents).values(rows);
        await tx
          .update(calendarConnections)
          .set({ status: 'active', lastSyncedAt: now })
          .where(eq(calendarConnections.id, connection.id));
      });
    } catch (error) {
      ok = false;
      log.error(`Calendar sync failed for user ${userId} (${connection.provider}):`, error instanceof Error ? error.message : error);
      await db.update(calendarConnections).set({ status: 'error', lastSyncedAt: now }).where(eq(calendarConnections.id, connection.id));
    }
  }

  await planMeetingNudges(db, userId, timezone, now);
  return { connected: true, ok };
}

/** Appointments overlapping [from, to) for a user. */
export async function eventsBetween(db: Database, userId: number, from: Date, to: Date): Promise<Array<DayEvent & { id: number; externalId: string; clientId: number | null; projectId: number | null }>> {
  return db
    .select({
      id: calendarEvents.id,
      externalId: calendarEvents.externalId,
      startsAt: calendarEvents.startsAtUtc,
      endsAt: calendarEvents.endsAtUtc,
      title: calendarEvents.title,
      isBusy: calendarEvents.isBusy,
      isAllDay: calendarEvents.isAllDay,
      clientId: calendarEvents.clientId,
      projectId: calendarEvents.projectId,
    })
    .from(calendarEvents)
    .where(and(eq(calendarEvents.userId, userId), lt(calendarEvents.startsAtUtc, to), sql`${calendarEvents.endsAtUtc} > ${from}`));
}

/**
 * Heads-up ten minutes before and a follow-up right after appointments linked to a client
 * or project, today, within max_calendar_nudges_per_day.
 */
export async function planMeetingNudges(db: Database, userId: number, timezone: string, now: Date) {
  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  if (!settings?.calendarEnabled) return;
  const today = localDate(timezone, now);
  const dayStart = DateTime.fromJSDate(now, { zone: timezone }).startOf('day');
  const events = (await eventsBetween(db, userId, now, dayStart.plus({ days: 1 }).toUTC().toJSDate()))
    .filter((e) => e.isBusy && !e.isAllDay && (e.clientId !== null || e.projectId !== null))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  const planned = await db
    .select({ id: scheduledNudges.id, kind: scheduledNudges.kind, status: scheduledNudges.status, payload: scheduledNudges.payload })
    .from(scheduledNudges)
    .where(
      and(
        eq(scheduledNudges.userId, userId),
        inArray(scheduledNudges.kind, ['meeting_heads_up', 'meeting_followup']),
        gte(scheduledNudges.scheduledForUtc, dayStart.toUTC().toJSDate()),
      ),
    );
  let count = planned.filter((n) => n.status !== 'skipped').length;

  for (const event of events) {
    const wanted = [
      ...(settings.meetingHeadsUp ? [{ kind: 'meeting_heads_up' as const, at: new Date(event.startsAt.getTime() - HEADS_UP_MINUTES * 60_000) }] : []),
      ...(settings.meetingFollowup ? [{ kind: 'meeting_followup' as const, at: event.endsAt }] : []),
    ];
    for (const nudge of wanted) {
      const existing = planned.find((n) => n.kind === nudge.kind && n.payload.eventId === event.externalId);
      if (existing) {
        // The appointment may have moved.
        if (existing.status === 'pending') await db.update(scheduledNudges).set({ scheduledForUtc: nudge.at }).where(eq(scheduledNudges.id, existing.id));
        continue;
      }
      if (nudge.at <= now || count >= settings.maxCalendarNudgesPerDay) continue;
      await db.insert(scheduledNudges).values({
        userId,
        kind: nudge.kind,
        scheduledForUtc: nudge.at,
        payload: { eventId: event.externalId, localDate: today },
      });
      count += 1;
    }
  }
}

/** Connections whose last sync is older than 15 minutes. */
export async function staleConnections(db: Database, now: Date) {
  return db
    .select({ userId: calendarConnections.userId })
    .from(calendarConnections)
    .where(
      and(
        inArray(calendarConnections.status, ['active', 'error']),
        sql`coalesce(${calendarConnections.lastSyncedAt}, 'epoch'::timestamptz) < ${new Date(now.getTime() - SYNC_EVERY_MS)}`,
      ),
    );
}
