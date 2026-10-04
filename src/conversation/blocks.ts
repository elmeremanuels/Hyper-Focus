// Work blocks, pitstops and the return (steps 1.9 and 1.12).
// A block runs 15, 25 or 45 minutes; in the focus window 45, 60 or 90. "Af" starts a
// screen-free pitstop; coming back gives the reward minute with today's focus log.
import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordEvent } from '../core/events.js';
import { getSettings } from '../core/settings.js';
import { listSteps, nextStep } from '../core/steps.js';
import { getTask, setTaskStatus } from '../core/tasks.js';
import type { Database } from '../db/client.js';
import { STALE_BLOCK_HOURS } from '../proactive/maintenance.js';
import { focusBlocks, focusWindows, scheduledNudges, userSettings } from '../db/schema/index.js';
import { DateTime } from 'luxon';
import { isInWindow, windowFor } from '../focus/windows.js';
import { localDate } from '../lib/time.js';
import { WINDOW_BUTTONS, WINDOW_TEXTS } from '../texts/focusvenster.nl.js';
import { BLOCK_BUTTONS, BLOCK_TEXTS, fill, PAUSE_MISSIONS, type PauseMission } from '../texts/werkblokken.nl.js';
import type { Composed } from '../proactive/messages.js';
import type { ButtonContext, ButtonExtension, ParsedButton } from './buttons.js';
import { generateSteps, SPLIT_ABOVE_MINUTES } from './session.js';
import { clearState, getState, setState } from './state.js';
import { defineTool, type ToolDefinition } from './tools.js';
import type { Button, OutboundMessage } from './types.js';
import { tomorrowPlan } from '../proactive/tomorrow-signals.js';
import { SHOW_TODAY } from './views.js';
import { workplaceButton } from './workplace.js';
import { whereYouWere } from './focus-window.js';

export const BLOCK_PRESETS = [15, 25, 45] as const;
/** In the focus window (step 1.12): 45, 60 or 90 minutes, 60 by default. */
export const WINDOW_PRESETS = [45, 60, 90] as const;
const ALL_PRESETS = [15, 25, 45, 60, 90] as const;
export type BlockMinutes = (typeof ALL_PRESETS)[number];
export const DEFAULT_BLOCK_MINUTES: BlockMinutes = 15;
export const DEFAULT_WINDOW_BLOCK_MINUTES: BlockMinutes = 60;
export const EXTEND_MINUTES = 15;
export const WINDOW_EXTEND_MINUTES = 30;
/** Continuous work before the hyperfocus catcher steps in; 90 inside the focus window. */
export const HYPERFOCUS_MINUTES = 60;
export const WINDOW_HYPERFOCUS_MINUTES = 90;
/** The one silent message in a window block comes after this many minutes. */
export const QUIET_CHECK_MINUTES = 50;
/** A pause or an unanswered block end closes this long after it was due. */
export const CLOSE_AFTER_MINUTES = 30;
/** Blocks this close together count as one stretch of work. */
const CHAIN_GAP_MINUTES = 30;

/** Nudges of the block flow: they only follow quiet hours and /pauze. */
export const BLOCK_NUDGE_KINDS = new Set(['block_end', 'return_reminder', 'pause_close', 'hyperfocus_break', 'window_quiet_check', 'soft_landing']);
/** Transitions make a sound; everything else during a block or pause is silent. */
export const SOUND_KINDS = new Set(['block_end', 'return_reminder', 'hyperfocus_break', 'window_heads_up', 'soft_landing']);

type Block = typeof focusBlocks.$inferSelect;
type Ctx = ButtonContext & { appBaseUrl?: string | undefined };

/** Rounds any duration to the nearest preset (15, 25, 45, 60, 90); ties go to the shorter block. */
export function roundToPreset(minutes: number): BlockMinutes {
  return [...ALL_PRESETS].sort((a, b) => Math.abs(a - minutes) - Math.abs(b - minutes) || a - b)[0] ?? DEFAULT_BLOCK_MINUTES;
}

/** Today's window when now counts as inside it. */
async function currentWindow(ctx: Pick<Ctx, 'db' | 'userId' | 'timezone' | 'now'>) {
  const window = await windowFor(ctx.db, ctx.userId, localDate(ctx.timezone, ctx.now));
  return isInWindow(window, ctx.now) ? window : undefined;
}

const lowerFirst = (value: string) => value.charAt(0).toLowerCase() + value.slice(1);
const minutesFrom = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000;

// ---------------------------------------------------------------------------
// State

/** The running block or the pause after it, if any. */
export async function activeBlock(db: Database, userId: number, now: Date): Promise<{ block: Block; phase: 'block' | 'pause' } | undefined> {
  const [block] = await db.select().from(focusBlocks).where(eq(focusBlocks.userId, userId)).orderBy(desc(focusBlocks.startedAt), desc(focusBlocks.id)).limit(1);
  if (!block || block.startedAt > now) return undefined;
  if (!block.endedAt) {
    // A block left open for hours is no longer running (verbeterplan P0.1); the hourly upkeep closes it.
    if (now.getTime() - block.endsAt.getTime() > STALE_BLOCK_HOURS * 3_600_000) return undefined;
    return { block, phase: 'block' };
  }
  if (block.pauseStartedAt && !block.returnedAt && block.pauseDueAt && minutesFrom(block.pauseDueAt, now) < CLOSE_AFTER_MINUTES) {
    return { block, phase: 'pause' };
  }
  return undefined;
}

/** During a block or pause messages go out without sound (BOUWPLAN 1.9). */
export async function isFocusQuiet(db: Database, userId: number, now: Date): Promise<boolean> {
  return (await activeBlock(db, userId, now)) !== undefined;
}

async function getBlock(db: Database, userId: number, blockId: number): Promise<Block | undefined> {
  const [block] = await db.select().from(focusBlocks).where(and(eq(focusBlocks.userId, userId), eq(focusBlocks.id, blockId)));
  return block;
}

async function updateBlock(db: Database, blockId: number, patch: Partial<typeof focusBlocks.$inferInsert>) {
  await db.update(focusBlocks).set(patch).where(eq(focusBlocks.id, blockId));
}

/** Minutes of work in the stretch this block belongs to: earlier blocks without a finished pause. */
export async function chainMinutes(db: Database, userId: number, block: Block, now: Date): Promise<number> {
  const earlier = await db
    .select()
    .from(focusBlocks)
    .where(and(eq(focusBlocks.userId, userId), lt(focusBlocks.startedAt, block.startedAt), isNotNull(focusBlocks.endedAt)))
    .orderBy(desc(focusBlocks.startedAt))
    .limit(10);
  let total = minutesFrom(block.startedAt, block.endedAt ?? now);
  let start = block.startedAt;
  for (const previous of earlier) {
    if (!previous.endedAt || previous.returnedAt || minutesFrom(previous.endedAt, start) > CHAIN_GAP_MINUTES) break;
    total += minutesFrom(previous.startedAt, previous.endedAt);
    start = previous.startedAt;
  }
  return total;
}

async function cancelBlockNudges(db: Database, userId: number, kinds: string[] = ['block_end', 'return_reminder', 'pause_close', 'hyperfocus_break', 'window_quiet_check']) {
  await db
    .update(scheduledNudges)
    .set({ status: 'skipped', skipReason: 'block_changed' })
    .where(
      and(
        eq(scheduledNudges.userId, userId),
        eq(scheduledNudges.status, 'pending'),
        inArray(scheduledNudges.kind, kinds as Array<typeof scheduledNudges.$inferSelect.kind>),
      ),
    );
  // Legacy check-ins from step 1.4.
  await db
    .update(scheduledNudges)
    .set({ status: 'skipped', skipReason: 'block_changed' })
    .where(
      and(
        eq(scheduledNudges.userId, userId),
        eq(scheduledNudges.status, 'pending'),
        eq(scheduledNudges.kind, 'session_checkin'),
        sql`coalesce(${scheduledNudges.payload}->>'planned', 'false') <> 'true'`,
      ),
    );
}

async function schedule(
  db: Database,
  userId: number,
  kind: 'block_end' | 'return_reminder' | 'pause_close' | 'hyperfocus_break' | 'window_quiet_check',
  at: Date,
  payload: Record<string, unknown>,
) {
  await db.insert(scheduledNudges).values({ userId, kind, scheduledForUtc: at, payload });
}

async function rewardsEnabled(db: Database, userId: number): Promise<boolean> {
  return (await getSettings(db, userId)).rewardsEnabled;
}


// ---------------------------------------------------------------------------
// Starting

export async function askDuration(ctx: Ctx, taskId: number, defaultMinutes: BlockMinutes = DEFAULT_BLOCK_MINUTES): Promise<OutboundMessage[]> {
  const task = await getTask(ctx.db, ctx.userId, taskId);
  if (!task || task.status === 'done' || task.status === 'released') {
    return [{ text: 'Die taak kan ik niet meer vinden.', buttons: [SHOW_TODAY] }];
  }
  // In the focus window: 45, 60 or 90 minutes of deep work.
  if (await currentWindow(ctx)) {
    return [
      {
        text: fill(WINDOW_TEXTS.askDeep, { taak: lowerFirst(task.title) }),
        buttons: WINDOW_PRESETS.map((m) => ({ id: `blk:t${task.id}:m${m}`, title: `${m} min` })),
      },
    ];
  }
  const order = [defaultMinutes, ...BLOCK_PRESETS.filter((m) => m !== defaultMinutes)].filter((m) => m <= 45).sort((a, b) => a - b);
  return [
    {
      text: fill(BLOCK_TEXTS.askDuration, { taak: lowerFirst(task.title) }),
      buttons: [...new Set(order)].map((m) => ({ id: `blk:t${task.id}:m${m}`, title: `${m} min` })),
    },
  ];
}

/** Starts a block on the next step of a task; a big task without steps is split first. */
export async function startBlock(ctx: Ctx, taskId: number, minutes: BlockMinutes): Promise<OutboundMessage[]> {
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
      console.error('Breaking down before a block failed:', error);
    }
  }

  // A running block ends when a new one starts.
  const running = await activeBlock(db, userId, now);
  if (running?.phase === 'block') await updateBlock(db, running.block.id, { endedAt: now, outcome: 'stopped' });
  await cancelBlockNudges(db, userId);

  const step = (await nextStep(db, userId, task.id)) ?? task;
  if (task.status !== 'in_progress') await setTaskStatus(db, userId, task.id, 'in_progress', now);
  if (step.id !== task.id && step.status !== 'in_progress') await setTaskStatus(db, userId, step.id, 'in_progress', now);

  const endsAt = new Date(now.getTime() + minutes * 60_000);
  // Before the new block exists: the sentence from the last soft landing.
  const where = await whereYouWere(db, userId, task.id);
  const window = await currentWindow(ctx);
  const [block] = await db
    .insert(focusBlocks)
    .values({ userId, taskId: task.id, stepId: step.id === task.id ? null : step.id, plannedMinutes: minutes, startedAt: now, endsAt, inWindow: Boolean(window) })
    .returning();
  if (!block) throw new Error('Starting a block failed');
  await schedule(db, userId, 'block_end', endsAt, { blockId: block.id });
  if (window) {
    await db
      .update(focusWindows)
      .set({ status: 'used', ...(window.startedBlockId === null && { startedBlockId: block.id }) })
      .where(eq(focusWindows.id, window.id));
    // One silent message after 50 minutes, nothing else until the end.
    if (minutes > QUIET_CHECK_MINUTES) await schedule(db, userId, 'window_quiet_check', new Date(now.getTime() + QUIET_CHECK_MINUTES * 60_000), { blockId: block.id });
  }
  await setState(db, userId, 'session', { taskId: task.id, stepId: step.id, blockId: block.id, phase: 'block', stuck: false }, new Date(endsAt.getTime() + 2 * 3_600_000));
  await recordEvent(db, userId, 'session_started', { minutes, taskId: task.id });
  await recordEvent(db, userId, 'block_started', { minutes });

  const link = await workplaceButton(db, userId, task);
  const stepLine = step.id !== task.id ? `\n${fill(BLOCK_TEXTS.firstStep, { stap: lowerFirst(step.title) })}` : '';
  replies.push({
    text: `${fill(BLOCK_TEXTS.started, { n: minutes, taak: lowerFirst(task.title) })}${stepLine}${where ? `\n${where}` : ''}`,
    buttons: [{ id: `blk:${block.id}:stop`, title: BLOCK_BUTTONS.stop }, ...(link ? [link] : [])],
  });
  return replies;
}

// ---------------------------------------------------------------------------
// End of a block (nudges)

function endButtons(blockId: number): Button[] {
  return [
    { id: `blk:${blockId}:done`, title: BLOCK_BUTTONS.done },
    { id: `blk:${blockId}:plus15`, title: BLOCK_BUTTONS.plus15 },
    { id: `blk:${blockId}:stop`, title: BLOCK_BUTTONS.stop },
  ];
}

function windowEndButtons(blockId: number): Button[] {
  return [
    { id: `blk:${blockId}:done`, title: WINDOW_BUTTONS.done },
    { id: `blk:${blockId}:plus30`, title: WINDOW_BUTTONS.plus30 },
    { id: `blk:${blockId}:stop`, title: WINDOW_BUTTONS.stop },
  ];
}

function hyperfocusMessage(blockId: number, minutes: number): OutboundMessage {
  return {
    text: fill(BLOCK_TEXTS.hyperfocus, { n: Math.round(minutes) }),
    buttons: [
      { id: `blk:${blockId}:break`, title: BLOCK_BUTTONS.takeBreak },
      { id: `blk:${blockId}:plus15`, title: BLOCK_BUTTONS.plus15 },
    ],
  };
}

/** block_end: the question at the end, or once per stretch of 60+ minutes the hyperfocus pause. */
export async function composeBlockEnd(ctx: { db: Database; userId: number; now: Date }, blockId: number): Promise<Composed> {
  const block = await getBlock(ctx.db, ctx.userId, blockId);
  if (!block || block.endedAt) return { skip: 'block_closed' };
  await schedule(ctx.db, ctx.userId, 'pause_close', new Date(ctx.now.getTime() + CLOSE_AFTER_MINUTES * 60_000), { blockId, phase: 'block' });

  const threshold = block.inWindow ? WINDOW_HYPERFOCUS_MINUTES : HYPERFOCUS_MINUTES;
  const chain = await chainMinutes(ctx.db, ctx.userId, block, ctx.now);
  if (block.hyperfocusPrompts === 0 && chain >= threshold) {
    await updateBlock(ctx.db, block.id, { hyperfocusPrompts: 1 });
    return { subject: 'Tijd voor een pitstop', message: hyperfocusMessage(block.id, chain) };
  }
  if (block.inWindow) {
    const task = block.taskId ? await getTask(ctx.db, ctx.userId, block.taskId) : undefined;
    const worked = Math.round(minutesFrom(block.startedAt, ctx.now));
    return {
      subject: 'Je venster zit erop',
      message: { text: fill(WINDOW_TEXTS.windowEnd, { n: worked, taak: lowerFirst(task?.title ?? 'je taak') }), buttons: windowEndButtons(block.id) },
    };
  }
  const n = block.extendedMinutes > 0 ? EXTEND_MINUTES : block.plannedMinutes;
  const task = block.taskId ? await getTask(ctx.db, ctx.userId, block.stepId ?? block.taskId) : undefined;
  return {
    subject: 'Je blok zit erop',
    message: { text: fill(BLOCK_TEXTS.end, { n, taak: lowerFirst(task?.title ?? 'je taak') }), buttons: endButtons(block.id) },
  };
}

/** hyperfocus_break: the second and last pause message after "Nog 15 min". */
export async function composeHyperfocusBreak(ctx: { db: Database; userId: number; now: Date }, blockId: number): Promise<Composed> {
  const block = await getBlock(ctx.db, ctx.userId, blockId);
  if (!block || block.endedAt) return { skip: 'block_closed' };
  await updateBlock(ctx.db, block.id, { hyperfocusPrompts: 2 });
  await schedule(ctx.db, ctx.userId, 'pause_close', new Date(ctx.now.getTime() + CLOSE_AFTER_MINUTES * 60_000), { blockId, phase: 'block' });
  return { subject: 'Tijd voor een pitstop', message: hyperfocusMessage(block.id, await chainMinutes(ctx.db, ctx.userId, block, ctx.now)) };
}

/** return_reminder: once, with sound, when the pause time ran out. */
export async function composeReturnReminder(ctx: { db: Database; userId: number; now: Date }, blockId: number): Promise<Composed> {
  const block = await getBlock(ctx.db, ctx.userId, blockId);
  if (!block || block.returnedAt || !block.pauseStartedAt) return { skip: 'returned' };
  return {
    subject: 'Terug naar je blok?',
    message: { text: BLOCK_TEXTS.returnReminder, buttons: [{ id: `blk:${block.id}:back`, title: BLOCK_BUTTONS.back }] },
  };
}

/** pause_close: closes an unanswered block end (expired) or pause, without a message. */
export async function closeQuietly(ctx: { db: Database; userId: number; now: Date }, blockId: number, phase: string): Promise<Composed> {
  const block = await getBlock(ctx.db, ctx.userId, blockId);
  if (!block) return { skip: 'closed' };
  if (phase === 'block' && !block.endedAt) {
    await updateBlock(ctx.db, block.id, { endedAt: ctx.now, outcome: 'expired' });
  }
  const state = await getState(ctx.db, ctx.userId, ctx.now);
  if (state.mode === 'session' && state.data.blockId === block.id) await clearState(ctx.db, ctx.userId);
  return { skip: 'closed' };
}

// ---------------------------------------------------------------------------
// Taps

async function pickMission(db: Database, userId: number): Promise<PauseMission> {
  const [last] = await db
    .select({ mission: focusBlocks.pauseMission })
    .from(focusBlocks)
    .where(and(eq(focusBlocks.userId, userId), isNotNull(focusBlocks.pauseMission)))
    .orderBy(desc(focusBlocks.pauseStartedAt))
    .limit(1);
  const options = (Object.keys(PAUSE_MISSIONS) as PauseMission[]).filter((m) => m !== last?.mission);
  return options[Math.floor(Math.random() * options.length)] ?? 'water';
}

/** "Afgerond" or "Pauze nemen": the block is done, the pause starts (silently). */
/**
 * "Afgerond", "Af" or "Pauze nemen": the block ends and the pitstop starts, silently.
 * Afgerond finishes the micro step worked on. In the focus window, Af answers "how is the
 * task?", so without steps it finishes the task itself (step 1.12).
 */
async function finishBlock(ctx: Ctx, block: Block, done: boolean): Promise<OutboundMessage[]> {
  const { db, userId, now } = ctx;
  await cancelBlockNudges(db, userId);
  let finished: { title: string } | undefined;
  const itemId = block.stepId ?? (block.inWindow ? block.taskId : null);
  if (done && itemId !== null) {
    const item = await getTask(db, userId, itemId);
    if (item) {
      if (item.status !== 'done') await setTaskStatus(db, userId, item.id, 'done', now);
      finished = item;
    }
  }
  const mission = await pickMission(db, userId);
  const { minutes, text } = PAUSE_MISSIONS[mission];
  const pauseDueAt = new Date(now.getTime() + minutes * 60_000);
  const worked = Math.max(1, Math.round(minutesFrom(block.startedAt, now)));
  await updateBlock(db, block.id, {
    endedAt: now,
    outcome: block.extendedMinutes > 0 ? 'extended' : 'completed',
    pauseMission: mission,
    pauseStartedAt: now,
    pauseDueAt,
    ...(finished && { resultNote: `${finished.title} af` }),
  });
  await recordEvent(db, userId, 'block_completed', { minutes: worked });
  await recordEvent(db, userId, 'session_completed', {});
  await schedule(db, userId, 'return_reminder', pauseDueAt, { blockId: block.id });
  await schedule(db, userId, 'pause_close', new Date(pauseDueAt.getTime() + CLOSE_AFTER_MINUTES * 60_000), { blockId: block.id, phase: 'pause' });
  await setState(db, userId, 'session', { taskId: block.taskId, stepId: block.stepId, blockId: block.id, phase: 'pause', stuck: false }, new Date(pauseDueAt.getTime() + CLOSE_AFTER_MINUTES * 60_000));
  const values = { n: worked, opdracht: text, tijd: localTimeOf(ctx.timezone, pauseDueAt) };
  return [
    {
      text: finished ? fill(BLOCK_TEXTS.pitstopDone, { ...values, taak: finished.title }) : fill(BLOCK_TEXTS.pitstopBreak, values),
      buttons: [{ id: `blk:${block.id}:back`, title: BLOCK_BUTTONS.back }],
    },
  ];
}

const localTimeOf = (timezone: string, at: Date) => DateTime.fromJSDate(at, { zone: timezone }).toFormat('HH:mm');

/** "Ik ben terug": on time the battery is full again; the reward minute stays either way. */
export async function returnFromPause(ctx: Ctx, block: Block): Promise<OutboundMessage[]> {
  const { db, userId, now } = ctx;
  const rewards = await rewardsEnabled(db, userId);
  const next: Button | undefined = block.taskId ? { id: `blk:t${block.taskId}:next`, title: BLOCK_BUTTONS.nextBlock } : undefined;
  if (block.returnedAt) return [{ text: BLOCK_TEXTS.backLate, ...(next && { buttons: [next] }) }];

  const onTime = Boolean(block.pauseDueAt && now <= block.pauseDueAt);
  await updateBlock(db, block.id, { returnedAt: now });
  await cancelBlockNudges(db, userId, ['return_reminder', 'pause_close']);
  await clearState(db, userId);
  await recordEvent(db, userId, 'pause_returned', { onTime });

  const buttons: Button[] = [];
  if (rewards && ctx.appBaseUrl) {
    const token = randomBytes(24).toString('base64url');
    await updateBlock(db, block.id, { rewardTokenHash: hashToken(token) });
    buttons.push({ id: `rwd:${block.id}`, title: BLOCK_BUTTONS.reward, webApp: `${ctx.appBaseUrl.replace(/\/$/, '')}/app/beloning?t=${token}` });
  }
  if (next) buttons.push(next);
  return [{ text: onTime ? BLOCK_TEXTS.backOnTime : BLOCK_TEXTS.backLate, ...(buttons.length > 0 && { buttons }) }];
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function extend(ctx: Ctx, block: Block, minutes = EXTEND_MINUTES): Promise<OutboundMessage[]> {
  const { db, userId, now } = ctx;
  await cancelBlockNudges(db, userId);
  const endsAt = new Date(now.getTime() + minutes * 60_000);
  await updateBlock(db, block.id, { endsAt, outcome: 'extended', extendedMinutes: block.extendedMinutes + minutes });
  // After the first hyperfocus message one more follows; after that only the normal question.
  await schedule(db, userId, block.hyperfocusPrompts === 1 ? 'hyperfocus_break' : 'block_end', endsAt, { blockId: block.id });
  const text = minutes === EXTEND_MINUTES ? BLOCK_TEXTS.extended : fill(BLOCK_TEXTS.extendedBy, { n: minutes });
  return [{ text, buttons: [{ id: `blk:${block.id}:stop`, title: BLOCK_BUTTONS.stop }] }];
}

async function stop(ctx: Ctx, block: Block): Promise<OutboundMessage[]> {
  await cancelBlockNudges(ctx.db, ctx.userId);
  if (!block.endedAt) await updateBlock(ctx.db, block.id, { endedAt: ctx.now, outcome: 'stopped' });
  await clearState(ctx.db, ctx.userId);
  return [{ text: BLOCK_TEXTS.stopped, buttons: [SHOW_TODAY] }];
}

/** Turns the reward minute and the garden on or off; blocks and pauses keep working. */
export async function setRewards(ctx: Pick<Ctx, 'db' | 'userId'>, enabled: boolean): Promise<OutboundMessage> {
  await ctx.db.update(userSettings).set({ rewardsEnabled: enabled }).where(eq(userSettings.userId, ctx.userId));
  await recordEvent(ctx.db, ctx.userId, 'rewards_toggled', { enabled });
  return enabled
    ? { text: BLOCK_TEXTS.rewardsOn }
    : { text: BLOCK_TEXTS.rewardsOff, buttons: [{ id: 'rw:on', title: BLOCK_BUTTONS.rewardsOnAgain }] };
}

export type DefaultBlockMinutes = (ctx: Ctx) => Promise<BlockMinutes>;

/** In the focus window 60; otherwise the last day review decides (step 1.11): 25 after high energy, else 15. */
export const planBlockMinutes: DefaultBlockMinutes = async (ctx) =>
  (await currentWindow(ctx)) ? DEFAULT_WINDOW_BLOCK_MINUTES : (await tomorrowPlan(ctx.db, ctx.userId, ctx.timezone, ctx.now)).blockMinutes;

/** blk:t{task}:m{15|25|45} · blk:t{task}:next · blk:{block}:{stop|done|break|plus15|back} · rw:on|off · t:{task}:start */
export function blockButtons(defaultMinutes: DefaultBlockMinutes = planBlockMinutes): ButtonExtension {
  return async (button: ParsedButton, ctx: Ctx) => {
    if (button.kind === 'task' && button.action === 'start') return askDuration(ctx, button.taskId, await defaultMinutes(ctx));
    if (button.kind === 'rewards') return [await setRewards(ctx, button.enabled)];
    if (button.kind !== 'block') return undefined;
    if (button.action === 'start') return startBlock(ctx, button.taskId, roundToPreset(button.minutes));
    if (button.action === 'next') return startBlock(ctx, button.taskId, await defaultMinutes(ctx));
    const block = await getBlock(ctx.db, ctx.userId, button.blockId);
    if (!block) return [{ text: 'Dat blok kan ik niet meer vinden.', buttons: [SHOW_TODAY] }];
    switch (button.action) {
      case 'stop':
        return stop(ctx, block);
      case 'done':
      case 'break':
        return block.endedAt ? [{ text: BLOCK_TEXTS.backLate }] : finishBlock(ctx, block, button.action === 'done');
      case 'plus15':
        return block.endedAt ? [{ text: BLOCK_TEXTS.backLate }] : extend(ctx, block);
      case 'plus30':
        return block.endedAt ? [{ text: BLOCK_TEXTS.backLate }] : extend(ctx, block, WINDOW_EXTEND_MINUTES);
      case 'back':
        return returnFromPause(ctx, block);
    }
  };
}

/** In a pause, "terug" or "ben terug" counts as the button. */
export async function pauseModeHandler(text: string, data: Record<string, unknown>, ctx: Ctx): Promise<OutboundMessage[] | undefined> {
  if (data.phase !== 'pause' || typeof data.blockId !== 'number') return undefined;
  if (!/^\s*(ik\s+)?(ben\s+)?(weer\s+)?terug\b/i.test(text)) return undefined;
  const block = await getBlock(ctx.db, ctx.userId, data.blockId);
  return block ? returnFromPause(ctx, block) : undefined;
}

// ---------------------------------------------------------------------------
// Router tools

export const startSessionTool = defineTool({
  name: 'start_session',
  description:
    'Start een werkblok op een taak ("start", "ik ga nu aan de offerte"). Noemt de gebruiker een duur, geef minutes (15, 25, 45, 60 of 90; ' +
    '"anderhalf uur" is 90; andere waarden rond ik af). Zonder duur vraag ik hoe lang.',
  input: z.object({ task_id: z.number().int(), minutes: z.number().int().min(1).max(240).optional() }),
  async run(input, ctx) {
    const replies =
      input.minutes === undefined ? await askDuration(ctx, input.task_id, await planBlockMinutes(ctx)) : await startBlock(ctx, input.task_id, roundToPreset(input.minutes));
    const last = replies.at(-1) ?? { text: '' };
    return { content: 'Werkblok afgehandeld.', reply: { ...last, text: replies.map((r) => r.text).join('\n\n') } };
  },
});

const returnFromPauseTool = defineTool({
  name: 'return_from_pause',
  description: 'De gebruiker is terug van een pauze ("ben terug", "terug"). Alleen als er een pauze loopt.',
  input: z.object({}),
  async run(_input, ctx) {
    const active = await activeBlock(ctx.db, ctx.userId, ctx.now);
    if (active?.phase !== 'pause') return { content: 'Er loopt geen pauze.', isError: true };
    const [reply] = await returnFromPause(ctx, active.block);
    return { content: 'Terug.', reply: reply ?? { text: BLOCK_TEXTS.backLate } };
  },
});

const setRewardsTool = defineTool({
  name: 'set_rewards',
  description: 'Zet de beloningsminuut en de tuin aan of uit ("zet beloningen uit"). Werkblokken en pauzes blijven werken.',
  input: z.object({ enabled: z.boolean() }),
  async run(input, ctx) {
    return { content: 'Ingesteld.', reply: await setRewards(ctx, input.enabled) };
  },
});

export const BLOCK_TOOLS: ToolDefinition[] = [startSessionTool, returnFromPauseTool, setRewardsTool];
