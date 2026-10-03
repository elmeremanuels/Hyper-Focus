// The messages of the daily rhythm (BOUWPLAN.md, 11.2 and 13). Deterministic: no AI call.
import { and, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { dailyFocus, tasks } from '../db/schema/index.js';
import { recordEvent } from '../core/events.js';
import { getTask, getTasksInOrder, listOpenTasks, type TaskSummary } from '../core/tasks.js';
import type { OutboundMessage } from '../conversation/types.js';
import { SHOW_TODAY } from '../conversation/views.js';
import { composeDayReview } from '../conversation/day-review.js';
import { morningWindowLine, prefQuestionOnce } from '../conversation/focus-window.js';
import { workplaceButton } from '../conversation/workplace.js';
import { REVIEW_BUTTONS, REVIEW_TEXTS } from '../texts/dagreview.nl.js';
import { DEFERRED_PROPOSAL_AT } from './tomorrow.js';
import { localDate } from '../lib/time.js';
import { calendarDayLine, calendarErrorLine, freeSlotOffer } from './calendar-messages.js';

export interface NudgeContext {
  db: Database;
  userId: number;
  name: string;
  timezone: string;
  now: Date;
  /** Local days since the user last wrote. */
  silentDays: number;
}

/** The composed message, or a reason to skip it. */
export type Composed =
  | {
      message: OutboundMessage;
      subject: string;
      /** Also send by mail when it went by Telegram. */
      alsoByMail?: boolean;
      /** Send by mail only. */
      mailOnly?: boolean;
      /** Sent right after the message, on the same channel. */
      followUps?: OutboundMessage[];
      /** Always without sound (step 1.12). */
      silent?: boolean;
    }
  | { skip: string };

/** After this many silent days the first message is a soft restart (BOUWPLAN.md, 11.6). */
export const REENTRY_AFTER_DAYS = 3;
/** Tasks without movement this long go to the parking lot on a restart. */
export const PARK_AFTER_DAYS = 14;

export const DAY_OFF = { id: 'f:dayoff', title: 'Vandaag vrij' };

async function plannedFocus(ctx: NudgeContext, localDate: string): Promise<TaskSummary[]> {
  const [planned] = await ctx.db
    .select({ taskIds: dailyFocus.taskIds })
    .from(dailyFocus)
    .where(and(eq(dailyFocus.userId, ctx.userId), eq(dailyFocus.localDate, localDate)));
  if (!planned) return [];
  const found = await getTasksInOrder(ctx.db, ctx.userId, planned.taskIds);
  return found.filter((task): task is TaskSummary => task !== undefined);
}

const isOpen = (task: TaskSummary) => task.status === 'open' || task.status === 'in_progress';

export async function composeMorning(ctx: NudgeContext, localDate: string): Promise<Composed> {
  if (ctx.silentDays >= REENTRY_AFTER_DAYS) return composeReentry(ctx, false);
  const focus = (await plannedFocus(ctx, localDate)).filter(isOpen);
  if (focus.length === 0) {
    return {
      subject: 'Goedemorgen',
      message: { text: `Goedemorgen ${ctx.name}. Er staat vandaag niets open. Stuur me wat je wilt doen, dan zet ik het klaar.` },
    };
  }
  const day = await calendarDayLine(ctx, localDate);
  // Only the top task gets a workplace button (step 1.10).
  const top = focus[0];
  const link = top ? await workplaceButton(ctx.db, ctx.userId, top) : undefined;
  // A task that keeps moving to tomorrow gets one proposal (step 1.11).
  const [deferred] = await ctx.db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.userId, ctx.userId), inArray(tasks.id, focus.map((task) => task.id)), gte(tasks.deferredCount, DEFERRED_PROPOSAL_AT)))
    .limit(1);
  const deferredTask = deferred ? focus.find((task) => task.id === deferred.id) : undefined;
  // The focus window (step 1.12): one line and [Schuif venster]; the preference question once.
  const window = await morningWindowLine(ctx, localDate);
  const prefQuestion = await prefQuestionOnce(ctx.db, ctx.userId, ctx.now);
  const followUps: OutboundMessage[] = [
    ...(deferredTask
      ? [
          {
            text: `${deferredTask.title}: ${REVIEW_TEXTS.deferred}`,
            buttons: [
              { id: `df:${deferredTask.id}:split`, title: REVIEW_BUTTONS.split },
              { id: `df:${deferredTask.id}:park`, title: REVIEW_BUTTONS.park },
              { id: `df:${deferredTask.id}:keep`, title: REVIEW_BUTTONS.keep },
            ],
          },
        ]
      : []),
    ...(prefQuestion ? [prefQuestion] : []),
  ];
  return {
    subject: 'Je focus voor vandaag',
    message: {
      text: `Goedemorgen ${ctx.name}.${day ? ` ${day}` : ''} Je focus voor vandaag staat klaar.${window ? `\n${window.line}` : ''}`,
      buttons: [SHOW_TODAY, DAY_OFF, ...(window ? [window.button] : []), ...(link ? [link] : [])],
    },
    ...(followUps.length > 0 && { followUps }),
  };
}

/** Only when the main task has not started yet. */
export async function composeMidday(ctx: NudgeContext, taskId: number): Promise<Composed> {
  const task = await getTask(ctx.db, ctx.userId, taskId);
  if (!task || task.status !== 'open') return { skip: 'main_task_started' };
  const slot = await freeSlotOffer(ctx, localDate(ctx.timezone, ctx.now), task);
  if (slot) return { subject: 'Samen beginnen?', message: slot };
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

/** The wrapup is the day review (step 1.11), with the calendar error when there is one. */
export async function composeWrapup(ctx: NudgeContext, localDate: string): Promise<Composed> {
  const composed = await composeDayReview(ctx, localDate);
  if ('skip' in composed) return composed;
  const calendarError = await calendarErrorLine(ctx);
  return calendarError ? { ...composed, message: { ...composed.message, text: `${composed.message.text}\n${calendarError}` } } : composed;
}

/**
 * Soft restart: welcome back and one smallest task; the list of open work only on request.
 * Tasks that stood still for 14 days or more go to the parking lot first.
 */
export async function composeReentry(ctx: NudgeContext, alsoByMail = true): Promise<Composed> {
  const cutoff = new Date(ctx.now.getTime() - PARK_AFTER_DAYS * 86_400_000);
  await ctx.db
    .update(tasks)
    .set({ status: 'parked', carryOver: false, snoozedUntil: null })
    .where(
      and(
        eq(tasks.userId, ctx.userId),
        inArray(tasks.status, ['open', 'in_progress']),
        isNull(tasks.parentTaskId),
        lt(tasks.updatedAt, cutoff),
      ),
    );
  await recordEvent(ctx.db, ctx.userId, 'reentry', { silentDays: ctx.silentDays });

  const open = await listOpenTasks(ctx.db, ctx.userId, 20, ctx.now);
  const smallest = [...open].sort((a, b) => (a.estimatedMinutes ?? 999) - (b.estimatedMinutes ?? 999))[0];
  const welcome = 'Welkom terug. Ik heb alles even stilgezet.';
  if (!smallest) {
    return { subject: 'Welkom terug', alsoByMail, message: { text: `${welcome} Stuur me wat je wilt doen, dan beginnen we klein.` } };
  }
  const minutes = smallest.estimatedMinutes ? `, ${smallest.estimatedMinutes} minuten` : '';
  return {
    subject: 'Welkom terug',
    alsoByMail,
    message: {
      text: `${welcome} Eén ding om mee te beginnen: ${lowerFirst(smallest.title)}${minutes}. Zullen we?`,
      buttons: [
        { id: `t:${smallest.id}:start`, title: 'Ja' },
        { id: `t:${smallest.id}:tomorrow`, title: 'Morgen' },
      ],
    },
  };
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}
