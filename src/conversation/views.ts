// Deterministic messages shared by buttons and tools (BOUWPLAN.md, 13).
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { dailyFocus, tasks } from '../db/schema/index.js';
import { getTasksInOrder, listOpenTasks, listParkedTasks, type TaskSummary } from '../core/tasks.js';
import { localDate } from '../lib/time.js';
import type { Button, OutboundMessage } from './types.js';

export const SHOW_TODAY: Button = { id: 'f:show', title: 'Laat zien' };

/** Today's focus: the planned daily_focus when there is one, else the top open tasks. */
export async function todaysFocus(db: Database, userId: number, timezone: string, now: Date): Promise<TaskSummary[]> {
  const [planned] = await db
    .select({ taskIds: dailyFocus.taskIds })
    .from(dailyFocus)
    .where(and(eq(dailyFocus.userId, userId), eq(dailyFocus.localDate, localDate(timezone, now))));

  if (planned && planned.taskIds.length > 0) {
    const found = await getTasksInOrder(db, userId, planned.taskIds);
    const open = found.filter(
      (task): task is TaskSummary => task !== undefined && (task.status === 'open' || task.status === 'in_progress'),
    );
    if (open.length > 0) return open;
  }
  return listOpenTasks(db, userId, 3, now);
}

export const ADJUST: Button = { id: 'f:adjust', title: 'Aanpassen' };
/** A main task longer than this shows its first micro step (BOUWPLAN.md, 11.3). */
const BIG_TASK_MINUTES = 60;

export interface FocusExtras {
  /** First open micro step per task id. */
  firstSteps?: Map<number, string>;
  quickWinTaskId?: number | null;
}

/** Tasks from today's planned focus that are still open, in focus order. */
export async function openFocusTasks(db: Database, userId: number, timezone: string, now: Date): Promise<TaskSummary[]> {
  const [planned] = await db
    .select({ taskIds: dailyFocus.taskIds })
    .from(dailyFocus)
    .where(and(eq(dailyFocus.userId, userId), eq(dailyFocus.localDate, localDate(timezone, now))));
  if (!planned) return [];
  const found = await getTasksInOrder(db, userId, planned.taskIds);
  return found.filter(
    (task): task is TaskSummary => task !== undefined && (task.status === 'open' || task.status === 'in_progress'),
  );
}

export function focusMessage(focus: TaskSummary[], extras: FocusExtras = {}): OutboundMessage {
  if (focus.length === 0) {
    return { text: 'Er staat niets open. Stuur me een taak, dan zet ik hem klaar.' };
  }
  const lines = focus.map((task, index) => {
    const minutes = task.estimatedMinutes ? ` · ${task.estimatedMinutes} min` : '';
    const step = (task.estimatedMinutes ?? 0) > BIG_TASK_MINUTES ? extras.firstSteps?.get(task.id) : undefined;
    return `${index + 1}. ${task.title}${minutes}${step ? `\n   Eerste stap: ${step}` : ''}`;
  });
  const quickWin = focus.length > 1 ? focus.find((task) => task.id === extras.quickWinTaskId) : undefined;
  const question = quickWin
    ? `Beginnen met ${lowerFirst(quickWin.title)}? Een snelle winst om op te warmen.`
    : 'Waar begin je mee?';
  return {
    text: `Vandaag, in deze volgorde:\n${lines.join('\n')}\n${question}`,
    buttons: [
      ...focus.map((task, index) => ({ id: `t:${task.id}:start`, title: `Start ${index + 1}` })),
      ADJUST,
    ],
  };
}

/** Today's focus as a message, with first steps and the quick win. */
export async function focusView(db: Database, userId: number, timezone: string, now: Date): Promise<OutboundMessage> {
  const focus = await todaysFocus(db, userId, timezone, now);
  const [planned] = await db
    .select({ quickWinTaskId: dailyFocus.quickWinTaskId })
    .from(dailyFocus)
    .where(and(eq(dailyFocus.userId, userId), eq(dailyFocus.localDate, localDate(timezone, now))));
  return focusMessage(focus, {
    firstSteps: await firstSteps(db, userId, focus.map((task) => task.id)),
    quickWinTaskId: planned?.quickWinTaskId ?? null,
  });
}

/** The first open micro step (subtask) of each task that has one. */
export async function firstSteps(db: Database, userId: number, taskIds: number[]): Promise<Map<number, string>> {
  if (taskIds.length === 0) return new Map();
  const rows = await db
    .select({ parentId: tasks.parentTaskId, title: tasks.title })
    .from(tasks)
    .where(
      and(eq(tasks.userId, userId), inArray(tasks.parentTaskId, taskIds), inArray(tasks.status, ['open', 'in_progress'])),
    )
    .orderBy(asc(tasks.id));
  const steps = new Map<number, string>();
  for (const row of rows) {
    if (row.parentId !== null && !steps.has(row.parentId)) steps.set(row.parentId, row.title);
  }
  return steps;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

export async function parkingMessage(db: Database, userId: number): Promise<OutboundMessage> {
  const parked = await listParkedTasks(db, userId, 8);
  if (parked.length === 0) {
    return { text: 'Je parkeerplaats is leeg.' };
  }
  return {
    text: `Op je parkeerplaats staan ${parked.length === 1 ? '1 taak' : `${parked.length} taken`}. Tik er een aan om hem terug te halen.`,
    choices: parked.map((task) => ({ id: `t:${task.id}:unpark`, title: task.title })),
  };
}
