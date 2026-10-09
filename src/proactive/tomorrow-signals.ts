// Reads the signals for tomorrow's plan from the day review and the work blocks (step 1.11).
import { and, desc, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { Database } from '../db/client.js';
import { dayReviews, focusBlocks, tasks } from '../db/schema/index.js';
import { localDate, startOfLocalDate } from '../lib/time.js';
import { isHyperfocusBlock, planTomorrow, type TomorrowPlan, type TomorrowSignals } from './tomorrow.js';

/** A review older than this no longer says anything about today. */
const REVIEW_MAX_AGE_DAYS = 3;
/** A pause counts once it is closed: returned, or 30 minutes past its time. */
const PAUSE_CLOSED_AFTER_MS = 30 * 60_000;

export async function tomorrowSignals(db: Database, userId: number, timezone: string, now: Date): Promise<TomorrowSignals> {
  const today = localDate(timezone, now);
  const oldest = DateTime.fromISO(today).minus({ days: REVIEW_MAX_AGE_DAYS }).toISODate() ?? today;
  const [review] = await db
    .select()
    .from(dayReviews)
    .where(and(eq(dayReviews.userId, userId), lt(dayReviews.date, today), gte(dayReviews.date, oldest)))
    .orderBy(desc(dayReviews.date))
    .limit(1);
  const reviewDay = review?.date ?? DateTime.fromISO(today).minus({ days: 1 }).toISODate() ?? today;
  const dayStart = startOfLocalDate(timezone, reviewDay);
  const todayStart = startOfLocalDate(timezone, today);

  const pauses = await db
    .select({ due: focusBlocks.pauseDueAt, returnedAt: focusBlocks.returnedAt })
    .from(focusBlocks)
    .where(and(eq(focusBlocks.userId, userId), isNotNull(focusBlocks.pauseDueAt), lt(focusBlocks.pauseStartedAt, todayStart)))
    .orderBy(desc(focusBlocks.pauseStartedAt))
    .limit(3);
  const lastPausesLate = pauses
    .filter((p) => p.returnedAt || (p.due && now.getTime() - p.due.getTime() > PAUSE_CLOSED_AFTER_MS))
    .map((p) => !p.returnedAt || (p.due !== null && p.returnedAt > p.due));

  const blocks = await db
    .select()
    .from(focusBlocks)
    .where(and(eq(focusBlocks.userId, userId), gte(focusBlocks.startedAt, dayStart), lt(focusBlocks.startedAt, todayStart)))
    .orderBy(desc(focusBlocks.startedAt));
  const candidates = [...new Set(blocks.filter(isHyperfocusBlock).map((b) => b.taskId).filter((id): id is number => id !== null))];
  const open = candidates.length
    ? await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.userId, userId), inArray(tasks.id, candidates), inArray(tasks.status, ['open', 'in_progress'])))
    : [];
  const openIds = new Set(open.map((t) => t.id));

  return {
    energy: review?.energy ?? null,
    lastPausesLate,
    hyperfocusTaskIds: candidates.filter((id) => openIds.has(id)),
  };
}

export async function tomorrowPlan(db: Database, userId: number, timezone: string, now: Date): Promise<TomorrowPlan> {
  return planTomorrow(await tomorrowSignals(db, userId, timezone, now));
}
