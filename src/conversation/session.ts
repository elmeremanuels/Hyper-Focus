// Breaking down tasks and the body-double mode (BOUWPLAN.md, 11.3–11.4).
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ClaudeClient } from '../ai/claude.js';
import { fillPrompt, loadPrompt } from '../ai/prompts.js';
import { recordEvent } from '../core/events.js';
import { getProfile } from '../core/profile.js';
import { getSettings } from '../core/settings.js';
import { addSteps, completeStep, listSteps, nextStep } from '../core/steps.js';
import { createTask, getTask, setTaskStatus, type TaskSummary } from '../core/tasks.js';
import type { Database } from '../db/client.js';
import { events, scheduledNudges } from '../db/schema/index.js';
import { localDate } from '../lib/time.js';
import type { ButtonContext, ButtonExtension } from './buttons.js';
import { clearState, getState, setState } from './state.js';
import { defineTool, resolveProject, runTool, toAnthropicTools, type ToolContext, type ToolDefinition } from './tools.js';
import type { Button, InboundSource, OutboundMessage } from './types.js';
import { SHOW_TODAY } from './views.js';

type Claude = Pick<ClaudeClient, 'callWithTools'>;

/** A main task longer than this gets micro steps before a session starts. */
export const SPLIT_ABOVE_MINUTES = 60;
const SESSION_GRACE_MS = 2 * 60 * 60 * 1000;
const PLUS_MINUTES = 10;

export const STUCK_TEXT = 'Waar zit het? Stuur een paar woorden of een spraakbericht, dan maken we de stap kleiner.';

export interface SessionData extends Record<string, unknown> {
  taskId: number;
  stepId: number;
  stuck: boolean;
}

// ---------------------------------------------------------------------------
// Breaking down

const stepSchema = z.object({
  title: z.string().min(3).max(120),
  minutes: z.union([z.literal(5), z.literal(15), z.literal(30)]),
});

export const breakDown = defineTool({
  name: 'break_down',
  description:
    'Knip een taak op in 3 tot 5 microstappen. De eerste stap duurt hooguit 10 minuten (minutes 5). ' +
    'Geef task_id voor een bestaande taak, of title (en eventueel client_name) voor een nieuwe.',
  input: z
    .object({
      task_id: z.number().int().optional(),
      title: z.string().min(2).max(200).optional(),
      client_name: z.string().optional(),
      steps: z.array(stepSchema).min(3).max(5),
    })
    .refine((input) => input.task_id !== undefined || input.title !== undefined, 'Geef task_id of title')
    .refine((input) => (input.steps[0]?.minutes ?? 0) <= 10, 'De eerste stap duurt hooguit 10 minuten (minutes 5)'),
  async run(input, ctx) {
    let parent: TaskSummary | undefined;
    if (input.task_id !== undefined) {
      parent = await getTask(ctx.db, ctx.userId, input.task_id);
      if (!parent) return { content: `Taak #${input.task_id} bestaat niet.`, isError: true };
    } else {
      const { projectId } = await resolveProject(ctx, { client_name: input.client_name });
      const total = input.steps.reduce((sum, step) => sum + step.minutes, 0);
      const { id } = await createTask(ctx.db, {
        userId: ctx.userId,
        projectId,
        title: input.title ?? 'Taak',
        estimatedMinutes: total <= 15 ? 15 : total <= 30 ? 30 : total <= 60 ? 60 : 120,
        dueDate: null,
        source: ctx.source,
      });
      parent = await getTask(ctx.db, ctx.userId, id);
    }
    if (!parent) return { content: 'Taak niet gevonden.', isError: true };

    await addSteps(ctx.db, ctx.userId, parent, input.steps, ctx.source);
    return { content: `Taak #${parent.id} opgeknipt.`, reply: stepsMessage(parent, input.steps) };
  },
});

function stepsMessage(task: TaskSummary, steps: Array<{ title: string; minutes: number }>): OutboundMessage {
  const lines = steps.map((step, index) => `${index + 1}. ${step.title} · ${step.minutes} min`);
  const first = steps[0];
  return {
    text: `Zo knippen we ${lowerFirst(task.title)} op:\n${lines.join('\n')}\nBeginnen met stap 1? Dat is ${first?.minutes ?? 5} minuten.`,
    buttons: [
      { id: `t:${task.id}:start`, title: 'Start stap 1' },
      { id: 'f:later', title: 'Later' },
    ],
  };
}

/** Asks the fast model for steps and stores them under `target` (a task or a step). */
export async function generateSteps(
  claude: Claude,
  ctx: Omit<ToolContext, 'source'> & { source?: InboundSource },
  target: TaskSummary,
  hint?: string,
): Promise<OutboundMessage | undefined> {
  const profile = await getProfile(ctx.db, ctx.userId);
  const parent = target.parentTaskId ? await getTask(ctx.db, ctx.userId, target.parentTaskId) : undefined;
  const lines = [
    `Taak: ${target.title}`,
    ...(parent ? [`Dit is een stap van: ${parent.title}`] : []),
    `Project: ${target.projectTitle}${target.clientName ? ` (klant ${target.clientName})` : ''}`,
    ...(hint ? [`Waar het vastloopt, in de woorden van ${profile?.name ?? 'de gebruiker'}: ${hint}`] : []),
  ];
  const result = await claude.callWithTools({
    userId: ctx.userId,
    purpose: 'break_down',
    tier: 'fast',
    system: fillPrompt(loadPrompt('opknippen'), { naam: profile?.name ?? 'de gebruiker' }),
    messages: [{ role: 'user', content: lines.join('\n') }],
    tools: toAnthropicTools([breakDown]),
    forceTool: 'break_down',
    maxTokens: 1024,
  });
  const call = result.toolCalls[0];
  if (!call) return undefined;
  const input: Record<string, unknown> = { ...(call.input as Record<string, unknown>), task_id: target.id };
  delete input.title;
  const outcome = await runTool([breakDown], 'break_down', input, { ...ctx, source: ctx.source ?? 'telegram' });
  return outcome.isError ? undefined : outcome.reply;
}

// ---------------------------------------------------------------------------
// Sessions

export const startSessionTool = defineTool({
  name: 'start_session',
  description: 'Start een werksessie op een taak ("start", "ik ga nu aan de offerte"). Ik noem één stap en check later bij de gebruiker.',
  input: z.object({ task_id: z.number().int() }),
  async run(input, ctx) {
    const replies = await startSession(ctx, input.task_id);
    return { content: 'Sessie gestart.', reply: { text: replies.map((reply) => reply.text).join('\n\n') } };
  },
});

export const SESSION_TOOLS: ToolDefinition[] = [breakDown, startSessionTool];

/** Starts a session on the next step of a task; splits a big task first when it has no steps. */
export async function startSession(
  ctx: Omit<ButtonContext, 'claude'> & { claude?: Claude | undefined; source?: InboundSource },
  taskId: number,
): Promise<OutboundMessage[]> {
  const { db, userId, now } = ctx;
  const task = await getTask(db, userId, taskId);
  if (!task || task.status === 'done' || task.status === 'released') {
    return [{ text: 'Die taak kan ik niet meer vinden.', buttons: [SHOW_TODAY] }];
  }

  const replies: OutboundMessage[] = [];
  const steps = await listSteps(db, userId, task.id);
  if (steps.length === 0 && (task.estimatedMinutes ?? 0) > SPLIT_ABOVE_MINUTES && ctx.claude) {
    try {
      const split = await generateSteps(ctx.claude, ctx, task);
      if (split) replies.push({ text: split.text.replace(/\nBeginnen met stap 1\?.*$/s, '') });
    } catch (error) {
      console.error('Breaking down before a session failed:', error);
    }
  }

  const step = (await nextStep(db, userId, task.id)) ?? task;
  if (task.status !== 'in_progress') await setTaskStatus(db, userId, task.id, 'in_progress', now);
  if (step.id !== task.id && step.status !== 'in_progress') await setTaskStatus(db, userId, step.id, 'in_progress', now);

  const { sessionMinutes } = await getSettings(db, userId);
  await scheduleCheckin(db, userId, { taskId: task.id, stepId: step.id }, now, sessionMinutes);
  await setState(db, userId, 'session', { taskId: task.id, stepId: step.id, stuck: false } satisfies SessionData, expiry(now, sessionMinutes));
  await recordEvent(db, userId, 'session_started', { minutes: sessionMinutes });

  replies.push({ text: `Top. Eén stap: ${lowerFirst(step.title)}. Ik check over ${sessionMinutes} minuten bij je.` });
  return replies;
}

function expiry(now: Date, minutes: number): Date {
  return new Date(now.getTime() + minutes * 60_000 + SESSION_GRACE_MS);
}

async function scheduleCheckin(
  db: Database,
  userId: number,
  payload: { taskId: number; stepId: number },
  now: Date,
  minutes: number,
) {
  await cancelCheckins(db, userId);
  await db.insert(scheduledNudges).values({
    userId,
    kind: 'session_checkin',
    scheduledForUtc: new Date(now.getTime() + minutes * 60_000),
    payload,
  });
}

async function cancelCheckins(db: Database, userId: number) {
  await db
    .update(scheduledNudges)
    .set({ status: 'skipped', skipReason: 'session_ended' })
    .where(
      and(eq(scheduledNudges.userId, userId), eq(scheduledNudges.kind, 'session_checkin'), eq(scheduledNudges.status, 'pending')),
    );
}

async function sessionData(ctx: ButtonContext, taskId: number): Promise<SessionData> {
  const state = await getState(ctx.db, ctx.userId, ctx.now);
  if (state.mode === 'session' && state.data.taskId === taskId) return state.data as SessionData;
  const step = await nextStep(ctx.db, ctx.userId, taskId);
  return { taskId, stepId: step?.id ?? taskId, stuck: false };
}

/** Completed sessions on the user's local today. */
async function sessionsToday(ctx: ButtonContext): Promise<number> {
  const rows = await ctx.db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.userId, ctx.userId),
        eq(events.name, 'session_completed'),
        sql`${events.props}->>'date' = ${localDate(ctx.timezone, ctx.now)}`,
      ),
    );
  return rows.length;
}

export async function handleSessionButton(
  action: 'done' | 'plus10' | 'stuck',
  taskId: number,
  ctx: ButtonContext,
): Promise<OutboundMessage[]> {
  const data = await sessionData(ctx, taskId);
  const step = await getTask(ctx.db, ctx.userId, data.stepId);
  if (!step) return [{ text: 'Die taak kan ik niet meer vinden.', buttons: [SHOW_TODAY] }];

  if (action === 'plus10') {
    await scheduleCheckin(ctx.db, ctx.userId, { taskId, stepId: step.id }, ctx.now, PLUS_MINUTES);
    await setState(ctx.db, ctx.userId, 'session', { ...data, stuck: false }, expiry(ctx.now, PLUS_MINUTES));
    return [{ text: 'Prima, nog 10 minuten. Ik check zo bij je.' }];
  }

  if (action === 'stuck') {
    await cancelCheckins(ctx.db, ctx.userId);
    await setState(ctx.db, ctx.userId, 'session', { ...data, stuck: true }, expiry(ctx.now, 0));
    return [{ text: STUCK_TEXT }];
  }

  // done
  await cancelCheckins(ctx.db, ctx.userId);
  const top = await completeStep(ctx.db, ctx.userId, step.id, ctx.now);
  await recordEvent(ctx.db, ctx.userId, 'session_completed', { date: localDate(ctx.timezone, ctx.now) });
  await clearState(ctx.db, ctx.userId);
  const count = await sessionsToday(ctx);

  let reply: OutboundMessage;
  if (!top || top.id === taskId || step.id === taskId) {
    const main = await getTask(ctx.db, ctx.userId, taskId);
    reply = { text: `✔ ${main?.title ?? step.title} is af.`, buttons: [SHOW_TODAY] };
  } else {
    const next = await nextStep(ctx.db, ctx.userId, taskId);
    reply = {
      text: `✔ Stap af. Volgende stap: ${lowerFirst(next?.title ?? '')}. Doorgaan?`,
      buttons: [
        { id: `t:${taskId}:start`, title: 'Doorgaan' },
        { id: 'f:later', title: 'Pauze' },
      ],
    };
  }
  if (count > 0 && count % 3 === 0) {
    reply = { ...reply, text: `${reply.text}\nDat was je ${count === 3 ? 'derde' : `${count}e`} sessie vandaag. Knap. Tijd voor een pauze?` };
  }
  return [reply];
}

/** Session and split buttons, and `t:{id}:start` as the start of a session. */
export function sessionButtons(): ButtonExtension {
  return async (button, ctx) => {
    if (button.kind === 'session') return handleSessionButton(button.action, button.taskId, ctx);
    if (button.kind !== 'task') return undefined;
    if (button.action === 'start') return startSession(ctx, button.taskId);
    if (button.action === 'split') return splitTask(ctx, button.taskId);
    return undefined;
  };
}

async function splitTask(ctx: ButtonContext, taskId: number): Promise<OutboundMessage[]> {
  const task = await getTask(ctx.db, ctx.userId, taskId);
  if (!task) return [{ text: 'Die taak kan ik niet meer vinden.', buttons: [SHOW_TODAY] }];
  const existing = await listSteps(ctx.db, ctx.userId, taskId);
  if (existing.length > 0) {
    const steps = existing.map((step) => ({ title: step.title, minutes: step.estimatedMinutes ?? 5 }));
    return [stepsMessage(task, steps)];
  }
  if (!ctx.claude) return [{ text: 'Opknippen lukt nu niet. Probeer het straks nog eens.', buttons: startButton(taskId) }];
  try {
    const reply = await generateSteps(ctx.claude, ctx, task);
    return [reply ?? { text: 'Opknippen lukte niet. Wil je de taak in een paar woorden beschrijven?' }];
  } catch (error) {
    console.error('Split failed:', error);
    return [{ text: 'Opknippen lukte niet. Probeer het straks nog eens.', buttons: startButton(taskId) }];
  }
}

function startButton(taskId: number): Button[] {
  return [{ id: `t:${taskId}:start`, title: 'Toch starten' }];
}

/** In session mode: after "Vastgelopen", the next message makes the step smaller. */
export async function sessionModeHandler(
  text: string,
  data: SessionData,
  ctx: ButtonContext,
): Promise<OutboundMessage[] | undefined> {
  if (!data.stuck) return undefined;
  const step = await getTask(ctx.db, ctx.userId, data.stepId);
  if (!step || !ctx.claude) return undefined;
  const split = await generateSteps(ctx.claude, ctx, step, text);
  if (!split) return undefined;
  const lines = split.text.split('\n').slice(1, -1).join('\n');
  const started = await startSession(ctx, data.taskId);
  return [{ text: `Kleiner dan:\n${lines}` }, ...started];
}

/** The check-in after a session (BOUWPLAN.md, 11.4). */
export async function composeCheckin(
  ctx: { db: Database; userId: number; now: Date },
  payload: { taskId: number; stepId: number },
): Promise<{ message: OutboundMessage; subject: string } | { skip: string }> {
  const state = await getState(ctx.db, ctx.userId, ctx.now);
  if (state.mode !== 'session' || state.data.taskId !== payload.taskId) return { skip: 'session_ended' };
  const step = await getTask(ctx.db, ctx.userId, payload.stepId);
  if (!step || step.status === 'done') return { skip: 'session_ended' };
  return {
    subject: 'Hoe ging het?',
    message: {
      text: `Hoe ging het met ${lowerFirst(step.title)}?`,
      buttons: [
        { id: `sess:${payload.taskId}:done`, title: 'Gedaan' },
        { id: `sess:${payload.taskId}:plus10`, title: 'Nog 10 min' },
        { id: `sess:${payload.taskId}:stuck`, title: 'Vastgelopen' },
      ],
    },
  };
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}
