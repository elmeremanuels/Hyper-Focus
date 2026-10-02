// Deterministic messages shared by buttons and tools (BOUWPLAN.md, 13).
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { dailyFocus } from '../db/schema/index.js';
import { getTask, listOpenTasks, listParkedTasks, type TaskSummary } from '../core/tasks.js';
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
    const found = await Promise.all(planned.taskIds.map((id) => getTask(db, userId, id)));
    const open = found.filter(
      (task): task is TaskSummary => task !== undefined && (task.status === 'open' || task.status === 'in_progress'),
    );
    if (open.length > 0) return open;
  }
  return listOpenTasks(db, userId, 3, now);
}

export function focusMessage(focus: TaskSummary[]): OutboundMessage {
  if (focus.length === 0) {
    return { text: 'Er staat niets open. Stuur me een taak, dan zet ik hem klaar.' };
  }
  const lines = focus.map((task, index) => {
    const minutes = task.estimatedMinutes ? ` · ${task.estimatedMinutes} min` : '';
    return `${index + 1}. ${task.title}${minutes}`;
  });
  return {
    text: `Vandaag, in deze volgorde:\n${lines.join('\n')}\nWaar begin je mee?`,
    buttons: focus.map((task, index) => ({ id: `t:${task.id}:start`, title: `Start ${index + 1}` })),
  };
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
