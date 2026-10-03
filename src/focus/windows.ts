// Focus windows in the database (step 1.12): planning, moving, the nudges around a window and
// learning the rhythm from blocks, finished tasks and day reviews.
import { and, desc, eq, gte, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { recordEvent } from '../core/events.js';
import { getSettings } from '../core/settings.js';
import type { Database } from '../db/client.js';
import { dayReviews, events, focusBlocks, focusWindows, rhythmProfiles, scheduledNudges, tasks, userSettings, users } from '../db/schema/index.js';
import { eventsBetween } from '../integrations/calendar/sync.js';
import { localTimeOnDate } from '../lib/time.js';
import { busyBlocks, freeBlocks } from '../proactive/daycalendar.js';
import { scoreHours, type RhythmResult } from './rhythm.js';
import { chooseWindow, DEFAULT_WINDOW_MINUTES, MIN_CONFIDENCE, PREF_WINDOWS, toMinutes, toTime, type FocusPref, type WindowInput } from './window.js';

export type WindowRow = typeof focusWindows.$inferSelect;

/** The heads-up comes this long before the window; a start this early counts as in the window. */
export const HEADS_UP_MINUTES = 15;
/** Without a start this long after the window opened, one message offers to move the task. */
export const MISSED_AFTER_MINUTES = 30;
/** The soft landing comes this long before a hard boundary. */
export const LANDING_MINUTES = 10;
/** A learned window moves at most this much per week without asking. */
export const MAX_SILENT_SHIFT = 30;
const LEARN_DAYS = 28;
const RELEARN_AFTER_MS = 7 * 86_400_000;

export const WINDOW_NUDGE_KINDS = ['window_heads_up', 'window_quiet_check', 'soft_landing', 'window_missed'] as const;

const localTime = (timezone: string, at: Date) => DateTime.fromJSDate(at, { zone: timezone }).toFormat('HH:mm');
const weekdayOf = (date: string) => DateTime.fromISO(date).weekday;

/** Today's window: the latest one that was not moved away. */
export async function windowFor(db: Database, userId: number, date: string): Promise<WindowRow | undefined> {
  const [row] = await db
    .select()
    .from(focusWindows)
    .where(and(eq(focusWindows.userId, userId), eq(focusWindows.date, date), ne(focusWindows.status, 'moved')))
    .orderBy(desc(focusWindows.createdAt), desc(focusWindows.id))
    .limit(1);
  return row;
}

export async function getWindow(db: Database, userId: number, windowId: number): Promise<WindowRow | undefined> {
  const [row] = await db.select().from(focusWindows).where(and(eq(focusWindows.userId, userId), eq(focusWindows.id, windowId)));
  return row;
}

/** A start from the heads-up on counts as a start in the window. */
export function isInWindow(window: WindowRow | undefined, now: Date): window is WindowRow {
  if (!window || (window.status !== 'planned' && window.status !== 'used')) return false;
  return now.getTime() >= window.startsAt.getTime() - HEADS_UP_MINUTES * 60_000 && now < window.endsAt;
}

/** The learned window for a weekday, only after the user said yes to it. */
async function learnedFor(db: Database, userId: number, weekday: number) {
  if (!(await rhythmAccepted(db, userId))) return undefined;
  const [row] = await db.select().from(rhythmProfiles).where(and(eq(rhythmProfiles.userId, userId), eq(rhythmProfiles.weekday, weekday)));
  return row ? { start: row.windowStart.slice(0, 5), minutes: row.minutes, confidence: row.confidence } : undefined;
}

export async function rhythmAccepted(db: Database, userId: number): Promise<boolean> {
  const [row] = await db.select({ id: events.id }).from(events).where(and(eq(events.userId, userId), eq(events.name, 'rhythm_accepted'))).limit(1);
  return Boolean(row);
}

export async function windowInput(db: Database, userId: number, date: string): Promise<WindowInput> {
  const [user] = await db
    .select({ pref: users.focusPref, start: users.focusWindowStart, minutes: users.focusWindowMinutes })
    .from(users)
    .where(eq(users.id, userId));
  const settings = await getSettings(db, userId);
  return {
    learned: await learnedFor(db, userId, weekdayOf(date)),
    pref: user?.pref ?? null,
    prefStart: user?.start ?? null,
    prefMinutes: user?.minutes ?? DEFAULT_WINDOW_MINUTES,
    quietStart: settings.quietStart,
    quietEnd: settings.quietEnd,
    workStart: settings.workStart.slice(0, 5),
    workEnd: settings.workEnd.slice(0, 5),
  };
}

/**
 * Plans the window for a date (called by the planner): a window moved there by hand wins,
 * then learned, preference and standard. Schedules the heads-up, the missed check and the
 * soft landing.
 */
export async function planWindow(db: Database, userId: number, timezone: string, date: string, taskId: number | null, now: Date): Promise<WindowRow | undefined> {
  let window = await windowFor(db, userId, date);
  if (window) {
    if (window.taskId === null && taskId !== null) {
      [window] = await db.update(focusWindows).set({ taskId }).where(eq(focusWindows.id, window.id)).returning();
    }
  } else {
    const choice = chooseWindow(await windowInput(db, userId, date));
    const { startsAt, endsAt } = await fitAroundAppointments(db, userId, timezone, date, localTimeOnDate(timezone, date, choice.start), choice.minutes);
    const [inserted] = await db
      .insert(focusWindows)
      .values({ userId, date, startsAt, endsAt, source: choice.source, taskId })
      .onConflictDoNothing()
      .returning();
    window = inserted;
  }
  if (window) await scheduleWindowNudges(db, userId, timezone, window, now, { missed: true });
  return window;
}

/** Appointments fall out of the window: it moves to the first free hour after its start, before the wrap-up. */
async function fitAroundAppointments(db: Database, userId: number, timezone: string, date: string, start: Date, minutes: number): Promise<{ startsAt: Date; endsAt: Date }> {
  const end = new Date(start.getTime() + minutes * 60_000);
  const settings = await getSettings(db, userId);
  if (!settings.calendarEnabled) return { startsAt: start, endsAt: end };
  const until = localTimeOnDate(timezone, date, settings.wrapupTime.slice(0, 5));
  const appointments = await eventsBetween(db, userId, start, until);
  if (busyBlocks(appointments, start, end).length === 0) return { startsAt: start, endsAt: end };
  const free = freeBlocks(start, until, busyBlocks(appointments, start, until)).find((b) => b.end.getTime() - b.start.getTime() >= MIN_WINDOW_MINUTES * 60_000);
  if (!free) return { startsAt: start, endsAt: end };
  return { startsAt: free.start, endsAt: new Date(Math.min(free.end.getTime(), free.start.getTime() + minutes * 60_000)) };
}

/** A window shorter than an hour is not worth moving to. */
const MIN_WINDOW_MINUTES = 60;

/** Heads-up 15 minutes before, the missed check 30 minutes after, and the soft landing. */
export async function scheduleWindowNudges(db: Database, userId: number, timezone: string, window: WindowRow, now: Date, options: { missed: boolean }) {
  await cancelWindowNudges(db, userId, window.id);
  const nudges: Array<{ kind: (typeof WINDOW_NUDGE_KINDS)[number]; at: Date; payload: Record<string, unknown> }> = [];
  const headsUp = new Date(window.startsAt.getTime() - HEADS_UP_MINUTES * 60_000);
  if (headsUp > now) nudges.push({ kind: 'window_heads_up', at: headsUp, payload: {} });
  const missed = new Date(window.startsAt.getTime() + MISSED_AFTER_MINUTES * 60_000);
  if (options.missed && missed > now) nudges.push({ kind: 'window_missed', at: missed, payload: {} });

  const boundary = await hardBoundary(db, userId, timezone, window);
  if (boundary) {
    const at = new Date(boundary.at.getTime() - LANDING_MINUTES * 60_000);
    if (at > now && at > window.startsAt) nudges.push({ kind: 'soft_landing', at, payload: { title: boundary.title } });
  }
  if (nudges.length === 0) return;
  await db.insert(scheduledNudges).values(
    nudges.map((n) => ({ userId, kind: n.kind, scheduledForUtc: n.at, payload: { windowId: window.id, localDate: window.date, ...n.payload } })),
  );
}

export async function cancelWindowNudges(db: Database, userId: number, windowId: number, kinds: readonly string[] = WINDOW_NUDGE_KINDS) {
  await db
    .update(scheduledNudges)
    .set({ status: 'skipped', skipReason: 'window_changed' })
    .where(
      and(
        eq(scheduledNudges.userId, userId),
        eq(scheduledNudges.status, 'pending'),
        inArray(scheduledNudges.kind, kinds as Array<(typeof WINDOW_NUDGE_KINDS)[number]>),
        sql`${scheduledNudges.payload}->>'windowId' = ${String(windowId)}`,
      ),
    );
}

/** The first appointment that starts inside the window, or the start of quiet hours. */
async function hardBoundary(db: Database, userId: number, timezone: string, window: WindowRow): Promise<{ at: Date; title: string | null } | undefined> {
  const settings = await getSettings(db, userId);
  const candidates: Array<{ at: Date; title: string | null }> = [];
  if (settings.calendarEnabled) {
    // An appointment right at the end of the window counts too: a block may run over.
    const appointments = await eventsBetween(db, userId, window.startsAt, new Date(window.endsAt.getTime() + 60_000));
    const first = appointments
      .filter((e) => e.isBusy && !e.isAllDay && e.startsAt > window.startsAt && e.startsAt <= window.endsAt)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
    if (first) candidates.push({ at: first.startsAt, title: first.title });
  }
  const quiet = localTimeOnDate(timezone, window.date, settings.quietStart.slice(0, 5));
  if (quiet > window.startsAt && quiet <= window.endsAt) candidates.push({ at: quiet, title: null });
  return candidates.sort((a, b) => a.at.getTime() - b.at.getTime())[0];
}

/**
 * Moves the window of a date to a time, or to the user's own time when none is given. The
 * window of today gets new nudges; the missed check does not come back.
 */
export async function moveWindow(
  ctx: { db: Database; userId: number; timezone: string; now: Date },
  date: string,
  time: string | undefined,
  taskId?: number | null,
): Promise<WindowRow> {
  const { db, userId, timezone, now } = ctx;
  const current = await windowFor(db, userId, date);
  const own = chooseWindow({ ...(await windowInput(db, userId, date)), manual: undefined });
  const start = time ?? own.start;
  const minutes = current ? Math.round((current.endsAt.getTime() - current.startsAt.getTime()) / 60_000) : own.minutes;
  const startsAt = localTimeOnDate(timezone, date, start);
  if (current) {
    await db.update(focusWindows).set({ status: 'moved' }).where(eq(focusWindows.id, current.id));
    await cancelWindowNudges(db, userId, current.id);
  }
  const values = {
    userId,
    date,
    startsAt,
    endsAt: new Date(startsAt.getTime() + minutes * 60_000),
    source: 'manual' as const,
    taskId: taskId ?? current?.taskId ?? null,
    status: 'planned' as const,
  };
  const [row] = await db
    .insert(focusWindows)
    .values(values)
    .onConflictDoUpdate({ target: [focusWindows.userId, focusWindows.date, focusWindows.startsAt], set: { status: 'planned', source: 'manual', taskId: values.taskId } })
    .returning();
  if (!row) throw new Error('Moving the focus window failed');
  await recordEvent(db, userId, 'focus_window_moved', { date, start }, now);
  // Only today's window gets nudges now; a later date gets them from the planner.
  if (date === DateTime.fromJSDate(now, { zone: timezone }).toISODate()) {
    await scheduleWindowNudges(db, userId, timezone, row, now, { missed: false });
  }
  return row;
}

export async function setFocusPref(db: Database, userId: number, pref: FocusPref, now: Date): Promise<string> {
  const start = PREF_WINDOWS[pref];
  await db.update(users).set({ focusPref: pref, focusWindowStart: start }).where(eq(users.id, userId));
  // Evening work means the work day runs into the evening: the window must fit in it.
  const settings = await getSettings(db, userId);
  const end = toTime(toMinutes(start) + DEFAULT_WINDOW_MINUTES);
  if (pref === 'evening' && toMinutes(settings.workEnd.slice(0, 5)) < toMinutes(end)) {
    await db.update(userSettings).set({ workEnd: end }).where(eq(userSettings.userId, userId));
  }
  await recordEvent(db, userId, 'focus_pref_set', { pref }, now);
  return start;
}

export const windowEnd = (start: string, minutes: number) => toTime(toMinutes(start) + minutes);
export { localTime };

// ---------------------------------------------------------------------------
// Rhythm (A2)

/** Scores the last 28 days; pure scoring in rhythm.ts. */
export async function computeRhythm(db: Database, userId: number, timezone: string, now: Date): Promise<RhythmResult> {
  const since = new Date(now.getTime() - LEARN_DAYS * 86_400_000);
  const settings = await getSettings(db, userId);
  const local = (at: Date) => DateTime.fromJSDate(at, { zone: timezone });
  const blockRows = await db.select().from(focusBlocks).where(and(eq(focusBlocks.userId, userId), gte(focusBlocks.startedAt, since), isNotNull(focusBlocks.endedAt)));
  const taskRows = await db
    .select({ completedAt: tasks.completedAt })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.status, 'done'), gte(tasks.completedAt, since)));
  const reviewRows = await db.select({ date: dayReviews.date, energy: dayReviews.energy }).from(dayReviews).where(eq(dayReviews.userId, userId));

  const blocks = blockRows.map((b) => {
    const start = local(b.startedAt);
    const end = local(b.endedAt ?? b.endsAt);
    const endMinute = end.hasSame(start, 'day') ? end.hour * 60 + end.minute : 24 * 60;
    return {
      date: start.toISODate() ?? '',
      weekday: start.weekday,
      startMinute: start.hour * 60 + start.minute,
      endMinute,
      outcome: b.outcome,
      extended: b.extendedMinutes > 0,
    };
  });
  const done = taskRows
    .filter((t): t is { completedAt: Date } => t.completedAt !== null)
    .map((t) => {
      const at = local(t.completedAt);
      return { date: at.toISODate() ?? '', weekday: at.weekday, minute: at.hour * 60 + at.minute };
    });
  return scoreHours(blocks, reviewRows, done, { quietStart: settings.quietStart, quietEnd: settings.quietEnd, workDays: settings.workDays });
}

/**
 * The nightly job (run by the planner, once a day): rewrites the profiles at most once a week.
 * After a yes, a window moves at most 30 minutes a week; a bigger jump waits for a new question.
 */
export async function learnRhythm(db: Database, userId: number, timezone: string, now: Date): Promise<RhythmResult | undefined> {
  const existing = await db.select().from(rhythmProfiles).where(eq(rhythmProfiles.userId, userId));
  if (existing.some((row) => now.getTime() - row.computedAt.getTime() < RELEARN_AFTER_MS)) return undefined;
  const result = await computeRhythm(db, userId, timezone, now);
  if (result.activeDays === 0) return result;
  const accepted = await rhythmAccepted(db, userId);
  for (const window of result.windows) {
    const old = existing.find((row) => row.weekday === window.weekday);
    let start = window.start;
    if (accepted && old && Math.abs(toMinutes(window.start) - toMinutes(old.windowStart)) > MAX_SILENT_SHIFT) {
      // Too big a jump: keep the window and ask again after the next weekly review.
      start = old.windowStart.slice(0, 5);
      await recordEvent(db, userId, 'rhythm_proposed', { pending: true, weekday: window.weekday, start: window.start }, now);
    }
    await db
      .insert(rhythmProfiles)
      .values({ userId, weekday: window.weekday, windowStart: start, minutes: window.minutes, confidence: window.confidence, computedAt: now })
      .onConflictDoUpdate({
        target: [rhythmProfiles.userId, rhythmProfiles.weekday],
        set: { windowStart: start, minutes: window.minutes, confidence: window.confidence, computedAt: now },
      });
  }
  return result;
}

export interface RhythmProposal {
  weekdays: number[];
  start: string;
}

/**
 * One proposal after the weekly review: once enough data is in and nobody asked yet, or when
 * a learned window wants to jump more than 30 minutes.
 */
export async function rhythmProposal(db: Database, userId: number, timezone: string, now: Date): Promise<RhythmProposal | undefined> {
  const asked = await db
    .select({ props: events.props, at: events.createdAt })
    .from(events)
    .where(and(eq(events.userId, userId), inArray(events.name, ['rhythm_proposed', 'rhythm_accepted', 'rhythm_kept'])))
    .orderBy(desc(events.createdAt), desc(events.id));
  const pending = asked.filter((e) => e.props.pending === true);
  const lastAnswer = asked.find((e) => e.props.pending !== true && e.props.asked === true);
  const accepted = await rhythmAccepted(db, userId);

  if (accepted) {
    const open = pending.filter((e) => !lastAnswer || e.at > lastAnswer.at);
    const first = open[0];
    if (!first) return undefined;
    return { weekdays: [...new Set(open.map((e) => Number(e.props.weekday)))].sort(), start: String(first.props.start) };
  }
  if (lastAnswer) return undefined;
  const result = await computeRhythm(db, userId, timezone, now);
  if (!result.eligible) return undefined;
  const { workDays } = await getSettings(db, userId);
  const strong = result.windows.filter((w) => workDays.includes(w.weekday) && w.confidence >= MIN_CONFIDENCE);
  if (strong.length === 0) return undefined;
  // The most common start among the work days, and the days that share it.
  const counts = new Map<string, number[]>();
  for (const w of strong) counts.set(w.start, [...(counts.get(w.start) ?? []), w.weekday]);
  const best = [...counts.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0];
  return best ? { start: best[0], weekdays: best[1] } : undefined;
}

/** Yes: the learned window counts from now on, at the proposed time for those days. */
export async function acceptRhythm(db: Database, userId: number, proposal: RhythmProposal, now: Date) {
  for (const weekday of proposal.weekdays) {
    await db
      .insert(rhythmProfiles)
      .values({ userId, weekday, windowStart: proposal.start, minutes: DEFAULT_WINDOW_MINUTES, confidence: 1, computedAt: now })
      .onConflictDoUpdate({
        target: [rhythmProfiles.userId, rhythmProfiles.weekday],
        set: { windowStart: proposal.start, confidence: sql`greatest(${rhythmProfiles.confidence}, ${MIN_CONFIDENCE})` },
      });
  }
  await recordEvent(db, userId, 'rhythm_accepted', { asked: true, ...proposal }, now);
}
