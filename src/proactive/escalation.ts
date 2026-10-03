// The escalation ladder for stuck tasks (BOUWPLAN.md, 11.5): tasks in the focus or with a
// deadline that do not move. At most one escalation message a day, about one task.
import { and, eq, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { Database } from '../db/client.js';
import { tasks } from '../db/schema/index.js';
import { recordEvent } from '../core/events.js';
import { getTask, setTaskStatus } from '../core/tasks.js';
import type { Composed, NudgeContext } from './messages.js';

export const ESCALATION_TIME = '11:00';
/** Deadline tasks join the ladder when the deadline is this close. */
export const DEADLINE_WINDOW_DAYS = 14;

export type EscalationLevel = 1 | 2 | 3;

/** Days without movement → level: 2 → 1, 4 → 2, 7 → 3. */
export function levelForDays(days: number): EscalationLevel | 0 {
  if (days >= 7) return 3;
  if (days >= 4) return 2;
  if (days >= 2) return 1;
  return 0;
}

function localDays(from: Date, to: Date, timezone: string): number {
  const a = DateTime.fromJSDate(from, { zone: timezone }).startOf('day');
  const b = DateTime.fromJSDate(to, { zone: timezone }).startOf('day');
  return Math.round(b.diff(a, 'days').days);
}

/**
 * Starts the clock (stuck_since) for focus and deadline tasks without one, and returns
 * the one task to escalate today, if any.
 */
export async function pickEscalation(
  db: Pick<Database, 'select' | 'update'>,
  userId: number,
  focusTaskIds: number[],
  today: string,
  timezone: string,
  now: Date,
): Promise<{ taskId: number; level: EscalationLevel } | undefined> {
  const deadline = DateTime.fromISO(today).plus({ days: DEADLINE_WINDOW_DAYS }).toISODate() ?? today;
  const inLadder = and(
    eq(tasks.userId, userId),
    eq(tasks.status, 'open'),
    isNull(tasks.parentTaskId),
    or(
      focusTaskIds.length > 0 ? inArray(tasks.id, focusTaskIds) : undefined,
      and(isNotNull(tasks.dueDate), lte(tasks.dueDate, deadline)),
    ),
  );

  await db.update(tasks).set({ stuckSince: now }).where(and(inLadder, isNull(tasks.stuckSince)));
  const rows = await db
    .select({ id: tasks.id, stuckSince: tasks.stuckSince, lastLevel: tasks.lastEscalationLevel })
    .from(tasks)
    .where(and(inLadder, isNotNull(tasks.stuckSince)));

  const due = rows
    .map((row) => ({ ...row, level: levelForDays(localDays(row.stuckSince ?? now, now, timezone)) }))
    .filter((row) => row.level > row.lastLevel)
    .sort((a, b) => b.level - a.level || (a.stuckSince?.getTime() ?? 0) - (b.stuckSince?.getTime() ?? 0));
  const pick = due[0];
  return pick && pick.level > 0 ? { taskId: pick.id, level: pick.level as EscalationLevel } : undefined;
}

export async function composeEscalation(ctx: NudgeContext, taskId: number, level: number): Promise<Composed> {
  const task = await getTask(ctx.db, ctx.userId, taskId);
  if (!task || task.status !== 'open') return { skip: 'task_moved' };

  await ctx.db.update(tasks).set({ lastEscalationLevel: level }).where(eq(tasks.id, taskId));
  await recordEvent(ctx.db, ctx.userId, 'escalation', { level });
  const title = lowerFirst(task.title);

  if (level >= 3) {
    await setTaskStatus(ctx.db, ctx.userId, taskId, 'parked', ctx.now);
    return {
      subject: 'Op je parkeerplaats',
      message: {
        text: `${title} staat op je parkeerplaats. Terughalen kan altijd.`,
        buttons: [{ id: `t:${taskId}:unpark`, title: 'Terughalen' }],
      },
    };
  }
  if (level === 2) {
    return {
      subject: task.title,
      message: {
        text: `${task.title} blijft liggen. Te groot of te vaag?`,
        buttons: [
          { id: `t:${taskId}:split`, title: 'Opknippen' },
          { id: `t:${taskId}:park`, title: 'Parkeren' },
          { id: `t:${taskId}:release`, title: 'Loslaten' },
        ],
      },
    };
  }
  return {
    subject: task.title,
    message: {
      text: `Zal ik ${title} opknippen? Een kleine eerste stap helpt.`,
      buttons: [
        { id: `t:${taskId}:split`, title: 'Opknippen' },
        { id: `t:${taskId}:tomorrow`, title: 'Morgen' },
      ],
    },
  };
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}
