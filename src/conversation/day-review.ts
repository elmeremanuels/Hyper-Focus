// The day review (step 1.11): per open focus task one choice, then the energy, then
// optionally what is stuck for tomorrow. Skipped reviews close silently at midnight.
import { and, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordEvent } from '../core/events.js';
import { getSettings } from '../core/settings.js';
import { carryOver, getTask, setTaskStatus } from '../core/tasks.js';
import type { Database } from '../db/client.js';
import { dayReviews, focusBlocks, tasks } from '../db/schema/index.js';
import { localDate, startOfLocalDate, startOfNextLocalDay } from '../lib/time.js';
import type { Composed } from '../proactive/messages.js';
import type { Energy } from '../proactive/tomorrow.js';
import { ENERGY_LABELS, REVIEW_BUTTONS, REVIEW_TEXTS } from '../texts/dagreview.nl.js';
import { fill } from '../texts/werkblokken.nl.js';
import type { ButtonContext, ButtonExtension, ParsedButton } from './buttons.js';
import { splitTask } from './session.js';
import { clearState, getState, setState } from './state.js';
import { defineTool, type ToolDefinition } from './tools.js';
import type { Button, OutboundMessage } from './types.js';
import { openFocusTasks } from './views.js';

/** Tasks asked one by one; the rest goes with [Alles morgen]. */
export const MAX_REVIEW_TASKS = 3;

type Step = 'tasks' | 'energy' | 'stuck';
interface ReviewData extends Record<string, unknown> {
  date: string;
  queue: number[];
  step: Step;
}
type Ctx = Pick<ButtonContext, 'db' | 'userId' | 'timezone' | 'now'> & Partial<Pick<ButtonContext, 'claude'>>;

const lowerFirst = (value: string) => value.charAt(0).toLowerCase() + value.slice(1);

async function ensureReview(db: Database, userId: number, date: string) {
  await db.insert(dayReviews).values({ userId, date }).onConflictDoNothing({ target: [dayReviews.userId, dayReviews.date] });
}

async function saveState(ctx: Ctx, data: ReviewData) {
  // The review closes silently at midnight.
  await setState(ctx.db, ctx.userId, 'wrapup', data, startOfNextLocalDay(ctx.timezone, ctx.now));
}

function taskButtons(taskId: number, more: boolean): Button[] {
  return [
    { id: `dr:${taskId}:tomorrow`, title: REVIEW_BUTTONS.tomorrow },
    { id: `dr:${taskId}:split`, title: REVIEW_BUTTONS.split },
    { id: `dr:${taskId}:park`, title: REVIEW_BUTTONS.park },
    { id: `dr:${taskId}:done`, title: REVIEW_BUTTONS.done },
    ...(more ? [{ id: 'dr:rest', title: REVIEW_BUTTONS.rest }] : []),
  ];
}

const ENERGY_QUESTION: OutboundMessage = {
  text: REVIEW_TEXTS.energy,
  buttons: [
    { id: 'dr:e:low', title: REVIEW_BUTTONS.low },
    { id: 'dr:e:normal', title: REVIEW_BUTTONS.normal },
    { id: 'dr:e:high', title: REVIEW_BUTTONS.high },
  ],
};

const STUCK_QUESTION: OutboundMessage = { text: REVIEW_TEXTS.stuck, buttons: [{ id: 'dr:close', title: REVIEW_BUTTONS.close }] };

/** The next question: the next open task, or the energy. */
async function nextQuestion(ctx: Ctx, data: ReviewData, intro = ''): Promise<OutboundMessage> {
  for (let id = data.queue[0]; id !== undefined; id = data.queue[0]) {
    const task = await getTask(ctx.db, ctx.userId, id);
    if (task && (task.status === 'open' || task.status === 'in_progress')) {
      await saveState(ctx, { ...data, step: 'tasks' });
      return {
        text: `${intro}${fill(REVIEW_TEXTS.task, { taak: lowerFirst(task.title) })}`,
        buttons: taskButtons(task.id, data.queue.length > 1),
      };
    }
    data.queue.shift();
  }
  await saveState(ctx, { ...data, queue: [], step: 'energy' });
  return { ...ENERGY_QUESTION, text: `${intro}${ENERGY_QUESTION.text}` };
}

/** The wrapup nudge becomes the day review. Without a focus today it stays silent. */
export async function composeDayReview(ctx: Ctx, date: string): Promise<Composed> {
  if (localDate(ctx.timezone, ctx.now) !== date) return { skip: 'other_day' };
  const open = await openFocusTasks(ctx.db, ctx.userId, ctx.timezone, ctx.now);
  const blocksToday = await completedBlocks(ctx, date);
  const [planned] = await ctx.db.execute<{ n: number }>(
    sql`select coalesce(array_length(task_ids, 1), 0) as n from daily_focus where user_id = ${ctx.userId} and local_date = ${date}`,
  ).then((r) => r.rows);
  if (Number(planned?.n ?? 0) === 0 && blocksToday === 0) return { skip: 'no_focus' };

  await ensureReview(ctx.db, ctx.userId, date);
  const queue = open.slice(0, MAX_REVIEW_TASKS).map((task) => task.id);
  const message = await nextQuestion(ctx, { date, queue, step: 'tasks' }, `${REVIEW_TEXTS.start} `);
  return { subject: 'De dag afronden', message };
}

async function completedBlocks(ctx: Ctx, date: string): Promise<number> {
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(focusBlocks)
    .where(
      and(eq(focusBlocks.userId, ctx.userId), eq(focusBlocks.outcome, 'completed'), gte(focusBlocks.startedAt, startOfLocalDate(ctx.timezone, date))),
    );
  return row?.n ?? 0;
}

async function reviewData(ctx: Ctx): Promise<ReviewData | undefined> {
  const state = await getState(ctx.db, ctx.userId, ctx.now);
  return state.mode === 'wrapup' ? (state.data as ReviewData) : undefined;
}

/** Saves the energy of a day; the review counts as done once the energy is in. */
export async function saveEnergy(ctx: Ctx, energy: Energy, date = localDate(ctx.timezone, ctx.now)): Promise<void> {
  await ctx.db
    .insert(dayReviews)
    .values({ userId: ctx.userId, date, energy, completedAt: ctx.now })
    .onConflictDoUpdate({ target: [dayReviews.userId, dayReviews.date], set: { energy, completedAt: ctx.now, skipped: false } });
  await recordEvent(ctx.db, ctx.userId, 'day_energy_set', { energy });
}

/** The closing line; clears the review. */
export async function closeDayReview(ctx: Ctx, date = localDate(ctx.timezone, ctx.now)): Promise<OutboundMessage> {
  await clearState(ctx.db, ctx.userId);
  await recordEvent(ctx.db, ctx.userId, 'day_review_done', {});
  const n = await completedBlocks(ctx, date);
  const { morningTime } = await getSettings(ctx.db, ctx.userId);
  const blocks = n === 0 ? '' : ` ${n === 1 ? REVIEW_TEXTS.oneBlockDone : fill(REVIEW_TEXTS.blocksDone, { n })}`;
  return { text: `${REVIEW_TEXTS.thanks}${blocks} ${fill(REVIEW_TEXTS.ready, { tijd: morningTime.slice(0, 5) })}` };
}

async function moveToTomorrow(ctx: Ctx, taskId: number) {
  await carryOver(ctx.db, ctx.userId, taskId, startOfNextLocalDay(ctx.timezone, ctx.now));
}

async function handleTaskChoice(ctx: ButtonContext, taskId: number, action: 'tomorrow' | 'split' | 'park' | 'done'): Promise<OutboundMessage[]> {
  const task = await getTask(ctx.db, ctx.userId, taskId);
  if (!task) return [{ text: 'Die taak kan ik niet meer vinden.' }];
  const replies: OutboundMessage[] = [];
  if (action === 'tomorrow') await moveToTomorrow(ctx, taskId);
  if (action === 'park') await setTaskStatus(ctx.db, ctx.userId, taskId, 'parked', ctx.now);
  if (action === 'done') await setTaskStatus(ctx.db, ctx.userId, taskId, 'done', ctx.now);
  if (action === 'split') {
    // The steps are for tomorrow; the task moves along without counting as deferred.
    replies.push(...(await splitTask(ctx, taskId)).map(({ text }) => ({ text })));
    await ctx.db
      .update(tasks)
      .set({ carryOver: true, snoozedUntil: startOfNextLocalDay(ctx.timezone, ctx.now) })
      .where(and(eq(tasks.userId, ctx.userId), eq(tasks.id, taskId)));
  }

  const data = await reviewData(ctx);
  if (!data) return replies.length ? replies : [{ text: 'Genoteerd.' }];
  replies.push(await nextQuestion(ctx, { ...data, queue: data.queue.filter((id) => id !== taskId) }));
  return replies;
}

/** Deferred 3+ times: [Opknippen] [Parkeren] [Laat staan] from the morning message. */
async function handleDeferChoice(ctx: ButtonContext, taskId: number, action: 'split' | 'park' | 'keep'): Promise<OutboundMessage[]> {
  const task = await getTask(ctx.db, ctx.userId, taskId);
  if (!task) return [{ text: 'Die taak kan ik niet meer vinden.' }];
  await ctx.db.update(tasks).set({ deferredCount: 0 }).where(and(eq(tasks.userId, ctx.userId), eq(tasks.id, taskId)));
  if (action === 'split') return splitTask(ctx, taskId);
  if (action === 'park') {
    await setTaskStatus(ctx.db, ctx.userId, taskId, 'parked', ctx.now);
    return [{ text: `${task.title} staat op je parkeerplaats. Je haalt hem terug met "parkeerplaats".` }];
  }
  return [{ text: REVIEW_TEXTS.keep }];
}

/** dr:{task}:{tomorrow|split|park|done} · dr:rest · dr:e:{energy} · dr:close · df:{task}:{split|park|keep} */
export function dayReviewButtons(): ButtonExtension {
  return async (button: ParsedButton, ctx) => {
    if (button.kind === 'defer') return handleDeferChoice(ctx, button.taskId, button.action);
    if (button.kind !== 'day') return undefined;
    switch (button.action) {
      case 'task':
        return handleTaskChoice(ctx, button.taskId, button.choice);
      case 'rest': {
        const data = await reviewData(ctx);
        for (const id of data?.queue ?? []) {
          const task = await getTask(ctx.db, ctx.userId, id);
          if (task && (task.status === 'open' || task.status === 'in_progress')) await moveToTomorrow(ctx, id);
        }
        return [await nextQuestion(ctx, { date: data?.date ?? localDate(ctx.timezone, ctx.now), queue: [], step: 'energy' })];
      }
      case 'energy': {
        const data = await reviewData(ctx);
        const date = data?.date ?? localDate(ctx.timezone, ctx.now);
        await saveEnergy(ctx, button.energy, date);
        await saveState(ctx, { date, queue: [], step: 'stuck' });
        return [STUCK_QUESTION];
      }
      case 'close':
        return [await closeDayReview(ctx, (await reviewData(ctx))?.date)];
    }
  };
}

const NOTHING_STUCK = /^\s*(nee|nope|niks|niets|nee,? klaar|klaar|nee dank je)\W*$/i;

/**
 * In the last step any text counts: "nee" closes, anything else goes to the router first
 * (task, note or parking idea) and then closes.
 */
export async function dayReviewModeHandler(
  text: string,
  data: Record<string, unknown>,
  ctx: Ctx,
  route: (text: string) => Promise<OutboundMessage[]>,
): Promise<OutboundMessage[] | undefined> {
  if ((data as ReviewData).step !== 'stuck') return undefined;
  const date = (data as ReviewData).date;
  if (NOTHING_STUCK.test(text)) return [await closeDayReview(ctx, date)];
  await clearState(ctx.db, ctx.userId);
  const routed = await route(text);
  return [...routed, await closeDayReview(ctx, date)];
}

const setDayEnergyTool = defineTool({
  name: 'set_day_energy',
  description: 'Sla de energie van vandaag op ("energie was laag", "ik had veel energie"). De lijst van morgen past zich daarop aan.',
  input: z.object({ energy: z.enum(['low', 'normal', 'high']) }),
  async run(input, ctx) {
    await saveEnergy(ctx, input.energy);
    return { content: `Energie ${ENERGY_LABELS[input.energy]} opgeslagen.`, reply: { text: REVIEW_TEXTS.energySaved } };
  },
});

export const DAY_REVIEW_TOOLS: ToolDefinition[] = [setDayEnergyTool];

/** "Deze week: 2× laag, 3× gewoon." for the weekly review; empty without reviews. */
export async function energyWeekLine(db: Database, userId: number, since: string): Promise<string> {
  const rows = await db
    .select({ energy: dayReviews.energy, n: sql<number>`count(*)::int` })
    .from(dayReviews)
    .where(and(eq(dayReviews.userId, userId), gte(dayReviews.date, since), sql`${dayReviews.energy} is not null`))
    .groupBy(dayReviews.energy);
  const counts = new Map(rows.map((row) => [row.energy, row.n]));
  const parts = (['low', 'normal', 'high'] as const).filter((e) => counts.get(e)).map((e) => `${counts.get(e)}× ${ENERGY_LABELS[e]}`);
  return parts.length ? fill(REVIEW_TEXTS.energyWeek, { lijst: parts.join(', ') }) : '';
}
