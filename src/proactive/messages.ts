// The messages of the daily rhythm (BOUWPLAN.md, 11.2 and 13). Deterministic: no AI call.
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { dailyFocus } from '../db/schema/index.js';
import { getTask, type TaskSummary } from '../core/tasks.js';
import type { OutboundMessage } from '../conversation/types.js';
import { SHOW_TODAY } from '../conversation/views.js';

export interface NudgeContext {
  db: Database;
  userId: number;
  name: string;
  timezone: string;
  now: Date;
}

/** The composed message, or a reason to skip it. */
export type Composed =
  | { message: OutboundMessage; subject: string }
  | { skip: string };

export const DAY_OFF = { id: 'f:dayoff', title: 'Vandaag vrij' };

async function plannedFocus(ctx: NudgeContext, localDate: string): Promise<TaskSummary[]> {
  const [planned] = await ctx.db
    .select({ taskIds: dailyFocus.taskIds })
    .from(dailyFocus)
    .where(and(eq(dailyFocus.userId, ctx.userId), eq(dailyFocus.localDate, localDate)));
  if (!planned) return [];
  const found = await Promise.all(planned.taskIds.map((id) => getTask(ctx.db, ctx.userId, id)));
  return found.filter((task): task is TaskSummary => task !== undefined);
}

const isOpen = (task: TaskSummary) => task.status === 'open' || task.status === 'in_progress';

export async function composeMorning(ctx: NudgeContext, localDate: string): Promise<Composed> {
  const focus = (await plannedFocus(ctx, localDate)).filter(isOpen);
  if (focus.length === 0) {
    return {
      subject: 'Goedemorgen',
      message: { text: `Goedemorgen ${ctx.name}. Er staat vandaag niets open. Stuur me wat je wilt doen, dan zet ik het klaar.` },
    };
  }
  return {
    subject: 'Je focus voor vandaag',
    message: { text: `Goedemorgen ${ctx.name}. Je focus voor vandaag staat klaar.`, buttons: [SHOW_TODAY, DAY_OFF] },
  };
}

/** Only when the main task has not started yet. */
export async function composeMidday(ctx: NudgeContext, taskId: number): Promise<Composed> {
  const task = await getTask(ctx.db, ctx.userId, taskId);
  if (!task || task.status !== 'open') return { skip: 'main_task_started' };
  return {
    subject: 'Samen beginnen?',
    message: {
      text: `Zullen we samen beginnen aan ${lowerFirst(task.title)}? Ik check daarna bij je.`,
      buttons: [
        { id: `t:${task.id}:start`, title: 'Starten' },
        { id: 'f:later', title: 'Later' },
      ],
    },
  };
}

export async function composeWrapup(ctx: NudgeContext, localDate: string): Promise<Composed> {
  const focus = await plannedFocus(ctx, localDate);
  if (focus.length === 0) return { skip: 'no_focus' };

  const done = focus.filter((task) => task.status === 'done');
  const open = focus.filter(isOpen);
  const intro = 'Tijd om de dag af te ronden.';

  if (open.length === 0) {
    return { subject: 'De dag afronden', message: { text: `${intro} Alles uit je focus is af ✔ Sterk gedaan. Tot morgen.` } };
  }

  const first = open[0] as TaskSummary;
  const doneLine =
    done.length === 0
      ? ''
      : ` ${countWord(done.length)} van de ${countWord(focus.length).toLowerCase()} ${done.length === 1 ? 'is' : 'zijn'} af: ${listTitles(done)} ✔`;
  return {
    subject: 'De dag afronden',
    message: {
      text: `${intro}${doneLine} Wat doen we met ${lowerFirst(first.title)}?`,
      buttons: [
        { id: `t:${first.id}:tomorrow`, title: 'Morgen verder' },
        { id: `t:${first.id}:split`, title: 'Opknippen' },
        { id: `t:${first.id}:park`, title: 'Parkeren' },
        ...(open.length > 1 ? [{ id: 'f:carry', title: 'Alles morgen' }] : []),
        { id: 'f:alldone', title: 'Alles gedaan' },
      ],
    },
  };
}

const WORDS = ['Nul', 'Eén', 'Twee', 'Drie'];
function countWord(n: number): string {
  return WORDS[n] ?? String(n);
}

function listTitles(tasks: TaskSummary[]): string {
  const titles = tasks.map((task) => lowerFirst(task.title));
  return titles.length <= 1 ? (titles[0] ?? '') : `${titles.slice(0, -1).join(', ')} en ${titles.at(-1)}`;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}
