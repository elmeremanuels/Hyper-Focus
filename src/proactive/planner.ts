// Plans each user's day at 00:05 local time (BOUWPLAN.md, 11.1–11.3): the daily focus and
// the day's messages in scheduled_nudges, converted to UTC with Luxon.
import { and, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { dailyFocus, projects, scheduledNudges, tasks, users } from '../db/schema/index.js';
import { getSettings } from '../core/settings.js';
import { localDate, localNow, localTimeOnDate } from '../lib/time.js';
import { composeFocus, type ComposedFocus, type FocusCandidate } from './focus.js';

export const PLANNER_TIME = '00:05';
export const MIDDAY_TIME = '13:30';
/** Messages whose time passed longer ago than this are not planned (e.g. after downtime). */
const MAX_LATE_MS = 2 * 60 * 60 * 1000;

export type NudgeKind = typeof scheduledNudges.$inferInsert.kind;

export interface PlannedNudge {
  kind: NudgeKind;
  scheduledForUtc: Date;
  payload: Record<string, unknown>;
}

export interface PlanResult {
  userId: number;
  localDate: string;
  focus: ComposedFocus;
  nudges: PlannedNudge[];
}

/** Plans today for every active user whose local time is past 00:05 and who has no plan yet. */
export async function runPlanner(db: Database, now: Date = new Date()): Promise<PlanResult[]> {
  const targets = await db
    .select({ id: users.id, timezone: users.timezone })
    .from(users)
    .where(eq(users.status, 'active'));

  const results: PlanResult[] = [];
  for (const target of targets) {
    const local = localNow(target.timezone, now);
    if (local.toFormat('HH:mm') < PLANNER_TIME) continue;
    try {
      const result = await planDay(db, target.id, target.timezone, now);
      if (result) results.push(result);
    } catch (error) {
      console.error(`Planning failed for user ${target.id}:`, error);
    }
  }
  return results;
}

/** Plans the user's local today once. Returns undefined when it was already planned. */
export async function planDay(
  db: Database,
  userId: number,
  timezone: string,
  now: Date,
): Promise<PlanResult | undefined> {
  const today = localDate(timezone, now);
  const settings = await getSettings(db, userId);

  return db.transaction(async (tx) => {
    // The unique (user, date) row makes planning idempotent across ticks and processes.
    const [claimed] = await tx
      .insert(dailyFocus)
      .values({ userId, localDate: today })
      .onConflictDoNothing({ target: [dailyFocus.userId, dailyFocus.localDate] })
      .returning({ id: dailyFocus.id });
    if (!claimed) return undefined;

    const candidates = await focusCandidates(tx, userId, now);
    const focus = composeFocus(candidates, today, now);
    await tx
      .update(dailyFocus)
      .set({ taskIds: focus.taskIds, quickWinTaskId: focus.quickWinTaskId })
      .where(eq(dailyFocus.id, claimed.id));

    // Carried-over tasks got their bonus; it ends once they are in a focus.
    if (focus.taskIds.length > 0) {
      await tx.update(tasks).set({ carryOver: false }).where(inArray(tasks.id, focus.taskIds));
    }

    const nudges: PlannedNudge[] = [];
    const add = (kind: NudgeKind, time: string, payload: Record<string, unknown> = {}) => {
      const at = localTimeOnDate(timezone, today, time);
      if (now.getTime() - at.getTime() <= MAX_LATE_MS) {
        nudges.push({ kind, scheduledForUtc: at, payload: { localDate: today, ...payload } });
      }
    };
    add('morning', settings.morningTime);
    if (settings.middayEnabled && focus.mainTaskId !== null) {
      add('midday', MIDDAY_TIME, { taskId: focus.mainTaskId });
    }
    add('wrapup', settings.wrapupTime);

    if (nudges.length > 0) {
      await tx.insert(scheduledNudges).values(nudges.map((nudge) => ({ userId, ...nudge })));
    }
    return { userId, localDate: today, focus, nudges };
  });
}

/** Open or in-progress top-level tasks from active projects, not snoozed past now. */
export async function focusCandidates(db: Pick<Database, 'select'>, userId: number, now: Date): Promise<FocusCandidate[]> {
  return db
    .select({
      id: tasks.id,
      estimatedMinutes: tasks.estimatedMinutes,
      dueDate: tasks.dueDate,
      carryOver: tasks.carryOver,
      isWeeklyFocus: projects.isWeeklyFocus,
      projectPriority: projects.priority,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        eq(tasks.userId, userId),
        inArray(tasks.status, ['open', 'in_progress']),
        isNull(tasks.parentTaskId),
        eq(projects.status, 'active'),
        or(isNull(tasks.snoozedUntil), lte(tasks.snoozedUntil, now)),
      ),
    );
}
