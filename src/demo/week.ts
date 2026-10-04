// The demo week (step 2a.8): a demo account with a few work days of history, so the dashboard
// shows a filled Vandaag, focus log, battery and learned rhythm. Fictional content lives in
// src/db/seed/demo.ts; your own goes in scripts/demo-week.local.ts.
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { dayReviews, events, focusBlocks, focusWindows, projects, rhythmProfiles, scheduledNudges, tasks, users, userSettings } from '../db/schema/index.js';
import type { SeedData } from '../db/seed/types.js';
import { loadSeed } from '../db/seed/load.js';
import { localDate, localNow, localTimeOnDate } from '../lib/time.js';
import { planDay } from '../proactive/planner.js';

export interface DemoDay {
  /** Tasks finished that day; the first one is the work in the focus window. */
  done: string[];
  energy: 'low' | 'normal' | 'high';
}

export interface DemoWeek {
  seed: SeedData;
  /** The learned focus window (HH:MM), accepted after a weekly review. */
  windowStart: string;
  /** Past work days, oldest first; the last one is yesterday's work day. */
  days: DemoDay[];
  /** Tasks already finished today, newest last; their blocks end before the moment of seeding. */
  today?: string[];
  /** ISO weekdays; by default every day, so a demo looks lived-in on any day. */
  workDays?: number[];
}

const MINUTE = 60_000;

/** Creates the demo account with its history and plans today. Fails when the account exists. */
export async function seedDemoWeek(db: Database, week: DemoWeek, now: Date): Promise<{ userId: number }> {
  const { userId, created } = await loadSeed(db, week.seed);
  if (!created) throw new Error(`${week.seed.user.email} already exists; run with --reset to start over`);
  const timezone = week.seed.user.timezone ?? 'Europe/Amsterdam';
  const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.userId, userId)).limit(1);
  if (!project) throw new Error('The demo needs at least one project');

  const workDays = week.workDays ?? [1, 2, 3, 4, 5, 6, 7];
  await db.update(userSettings).set({ workDays }).where(eq(userSettings.userId, userId));

  // The learned rhythm, as if accepted after last week's review.
  for (const weekday of workDays) {
    await db.insert(rhythmProfiles).values({ userId, weekday, windowStart: week.windowStart, minutes: 90, confidence: 0.7, computedAt: now });
  }
  await db.insert(events).values({ userId, name: 'rhythm_accepted', props: { asked: true, weekdays: workDays, start: week.windowStart } });

  // Past work days, counted back from yesterday.
  const dates: string[] = [];
  let cursor = localNow(timezone, now).startOf('day');
  while (dates.length < week.days.length) {
    cursor = cursor.minus({ days: 1 });
    if (workDays.includes(cursor.weekday)) dates.unshift(cursor.toFormat('yyyy-MM-dd'));
  }
  for (const [i, day] of week.days.entries()) {
    const date = dates[i];
    if (date) await seedDay(db, userId, project.id, timezone, date, week.windowStart, day);
  }

  await planDay(db, userId, timezone, now);
  await seedToday(db, userId, project.id, timezone, now, week.today ?? []);
  // Nothing goes out for a demo account: no nudges, and the nightly planner skips it.
  await db.delete(scheduledNudges).where(and(eq(scheduledNudges.userId, userId), eq(scheduledNudges.status, 'pending')));
  await db.update(users).set({ status: 'paused' }).where(eq(users.id, userId));
  return { userId };
}

async function seedDay(db: Database, userId: number, projectId: number, timezone: string, date: string, windowStart: string, day: DemoDay) {
  const at = (time: string) => localTimeOnDate(timezone, date, time);
  const windowAt = at(windowStart);
  const doneIds: number[] = [];
  for (const [i, title] of day.done.entries()) {
    const completedAt = new Date(windowAt.getTime() + (i === 0 ? 65 : 240 + i * 45) * MINUTE);
    const [row] = await db
      .insert(tasks)
      .values({ userId, projectId, title, status: 'done', source: 'seed', estimatedMinutes: i === 0 ? 60 : 30, completedAt, createdAt: new Date(windowAt.getTime() - 2 * 86_400_000) })
      .returning({ id: tasks.id });
    if (row) doneIds.push(row.id);
  }

  // One block in the window, and a shorter one in the afternoon for every further task.
  const blockIds: number[] = [];
  for (const [i, taskId] of doneIds.entries()) {
    const startedAt = i === 0 ? new Date(windowAt.getTime() + 5 * MINUTE) : new Date(windowAt.getTime() + (215 + i * 45) * MINUTE);
    const minutes = i === 0 ? 60 : 25;
    const endsAt = new Date(startedAt.getTime() + minutes * MINUTE);
    const [block] = await db
      .insert(focusBlocks)
      .values({
        userId,
        taskId,
        plannedMinutes: minutes,
        startedAt,
        endsAt,
        endedAt: endsAt,
        outcome: 'completed',
        inWindow: i === 0,
        resultNote: `${day.done[i]} af`,
        pauseStartedAt: endsAt,
        pauseDueAt: new Date(endsAt.getTime() + 5 * MINUTE),
        returnedAt: new Date(endsAt.getTime() + 6 * MINUTE),
      })
      .returning({ id: focusBlocks.id });
    if (block) blockIds.push(block.id);
  }

  await db.insert(focusWindows).values({
    userId,
    date,
    startsAt: windowAt,
    endsAt: new Date(windowAt.getTime() + 90 * MINUTE),
    source: 'learned',
    taskId: doneIds[0] ?? null,
    startedBlockId: blockIds[0] ?? null,
    status: doneIds.length > 0 ? 'used' : 'missed',
  });
  await db.insert(dayReviews).values({ userId, date, energy: day.energy, completedAt: at('17:05') });
}

/** Blocks already done today, 25 minutes each, back to back before now; the window counts as used. */
async function seedToday(db: Database, userId: number, projectId: number, timezone: string, now: Date, titles: string[]) {
  const date = localDate(timezone, now);
  const [window] = await db.select().from(focusWindows).where(and(eq(focusWindows.userId, userId), eq(focusWindows.date, date)));
  const dayStart = localTimeOnDate(timezone, date, '07:00');
  for (const [i, title] of [...titles].reverse().entries()) {
    const endsAt = new Date(now.getTime() - (5 + i * 35) * MINUTE);
    const startedAt = new Date(endsAt.getTime() - 25 * MINUTE);
    if (startedAt < dayStart) break;
    const inWindow = Boolean(window && startedAt >= window.startsAt && endsAt <= window.endsAt);
    const [task] = await db.insert(tasks).values({ userId, projectId, title, status: 'done', source: 'seed', estimatedMinutes: 30, completedAt: endsAt }).returning({ id: tasks.id });
    const [block] = await db
      .insert(focusBlocks)
      .values({ userId, taskId: task?.id ?? null, plannedMinutes: 25, startedAt, endsAt, endedAt: endsAt, outcome: 'completed', inWindow, resultNote: `${title} af` })
      .returning({ id: focusBlocks.id });
    if (inWindow && window && block) await db.update(focusWindows).set({ status: 'used', startedBlockId: block.id }).where(eq(focusWindows.id, window.id));
  }
}

/** Removes the demo account and everything in it (all tables cascade on the user). */
export async function removeDemo(db: Database, email: string): Promise<boolean> {
  const removed = await db.delete(users).where(eq(users.email, email.toLowerCase())).returning({ id: users.id });
  return removed.length > 0;
}
