// The focus window in the conversation (step 1.12, A1 and A2): the preference question, the
// window line in the morning, the heads-up, the quiet check, the soft landing, a missed
// window, moving it, and the proposal of a learned window.
import { and, desc, eq, gt } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { recordEvent } from '../core/events.js';
import { getSettings } from '../core/settings.js';
import { carryOver, getTask, updateTaskDetails } from '../core/tasks.js';
import type { Database } from '../db/client.js';
import { events, focusBlocks, focusWindows, users } from '../db/schema/index.js';
import { chooseWindow, toMinutes, toTime, type FocusPref } from '../focus/window.js';
import {
  acceptRhythm,
  getWindow,
  localTime,
  moveWindow,
  rhythmProposal,
  setFocusPref,
  windowEnd,
  windowFor,
  windowInput,
  type WindowRow,
} from '../focus/windows.js';
import { localDate, startOfNextLocalDay } from '../lib/time.js';
import type { Composed } from '../proactive/messages.js';
import { firstFreeSlot } from '../proactive/daycalendar.js';
import { todaysEvents } from '../proactive/calendar-messages.js';
import { fill } from '../texts/werkblokken.nl.js';
import { WEEKDAY_NAMES, WINDOW_BUTTONS, WINDOW_TEXTS } from '../texts/focusvenster.nl.js';
import { normalizeDays } from '../focus/workweek.js';
import type { ButtonContext, ButtonExtension, ParsedButton } from './buttons.js';
import { getState, setState } from './state.js';
import { defineTool, type ToolDefinition } from './tools.js';
import type { Button, OutboundMessage } from './types.js';
import { workplaceButton } from './workplace.js';

type Ctx = Pick<ButtonContext, 'db' | 'userId' | 'timezone' | 'now'>;
type NudgeCtx = { db: Database; userId: number; timezone: string; now: Date };

const lowerFirst = (value: string) => value.charAt(0).toLowerCase() + value.slice(1);
const minutesOf = (w: WindowRow) => Math.round((w.endsAt.getTime() - w.startsAt.getTime()) / 60_000);

// ---------------------------------------------------------------------------
// Preference

export const PREF_QUESTION: OutboundMessage = {
  text: WINDOW_TEXTS.askPref,
  buttons: [
    { id: 'fp:morning', title: WINDOW_BUTTONS.morning },
    { id: 'fp:afternoon', title: WINDOW_BUTTONS.afternoon },
    { id: 'fp:evening', title: WINDOW_BUTTONS.evening },
    { id: 'fp:unknown', title: WINDOW_BUTTONS.unknown },
  ],
};

async function savePref(ctx: Ctx, pref: FocusPref): Promise<OutboundMessage> {
  const start = await setFocusPref(ctx.db, ctx.userId, pref, ctx.now);
  const [user] = await ctx.db.select({ minutes: users.focusWindowMinutes }).from(users).where(eq(users.id, ctx.userId));
  return { text: fill(WINDOW_TEXTS.prefSaved, { start, eind: windowEnd(start, user?.minutes ?? 90) }) };
}

/**
 * Existing users get the question once, 10 minutes after a morning message. With
 * `record: false` it only says whether the question is due.
 */
export async function prefQuestionOnce(db: Database, userId: number, now: Date, record = true): Promise<OutboundMessage | undefined> {
  const [user] = await db.select({ pref: users.focusPref }).from(users).where(eq(users.id, userId));
  if (!user || user.pref !== null) return undefined;
  const [asked] = await db.select({ id: events.id }).from(events).where(and(eq(events.userId, userId), eq(events.name, 'focus_pref_asked'))).limit(1);
  if (asked) return undefined;
  if (record) await recordEvent(db, userId, 'focus_pref_asked', {}, now);
  return PREF_QUESTION;
}

// ---------------------------------------------------------------------------
// Morning

/** "Je focusvenster vandaag: 10:30–12:00. Daar zet ik offerte Boho." with [Schuif venster]. */
export async function morningWindowLine(ctx: NudgeCtx, date: string): Promise<{ line: string; button: Button } | undefined> {
  const window = await windowFor(ctx.db, ctx.userId, date);
  if (!window || window.status !== 'planned' || !window.taskId) return undefined;
  const task = await getTask(ctx.db, ctx.userId, window.taskId);
  if (!task || task.status === 'done') return undefined;
  return {
    line: fill(WINDOW_TEXTS.morningLine, {
      start: localTime(ctx.timezone, window.startsAt),
      eind: localTime(ctx.timezone, window.endsAt),
      taak: lowerFirst(task.title),
    }),
    button: { id: `fw:${window.id}:move`, title: WINDOW_BUTTONS.move },
  };
}

// ---------------------------------------------------------------------------
// Nudges

async function windowTask(ctx: NudgeCtx, window: WindowRow) {
  const task = window.taskId ? await getTask(ctx.db, ctx.userId, window.taskId) : undefined;
  return task && task.status !== 'done' && task.status !== 'released' ? task : undefined;
}

async function runningBlock(db: Database, userId: number) {
  const [block] = await db.select().from(focusBlocks).where(eq(focusBlocks.userId, userId)).orderBy(desc(focusBlocks.startedAt), desc(focusBlocks.id)).limit(1);
  return block && !block.endedAt ? block : undefined;
}

/** 15 minutes before: the task and a start button, with the workplace button when there is one. */
export async function composeWindowHeadsUp(ctx: NudgeCtx, windowId: number): Promise<Composed> {
  const window = await getWindow(ctx.db, ctx.userId, windowId);
  if (!window || window.status !== 'planned' || ctx.now >= window.startsAt) return { skip: 'window_changed' };
  const task = await windowTask(ctx, window);
  if (!task) return { skip: 'no_task' };
  const link = await workplaceButton(ctx.db, ctx.userId, task);
  return {
    subject: 'Je focusvenster',
    message: {
      text: fill(WINDOW_TEXTS.headsUp, { taak: task.title }),
      buttons: [
        { id: `fw:${window.id}:start`, title: fill(WINDOW_BUTTONS.startAt, { tijd: localTime(ctx.timezone, window.startsAt) }) },
        { id: `fw:${window.id}:move`, title: WINDOW_BUTTONS.move },
        ...(link ? [link] : []),
      ],
    },
  };
}

/** After 50 minutes in a window block: one silent message, then nothing until the end. */
export async function composeWindowQuietCheck(ctx: NudgeCtx, blockId: number): Promise<Composed> {
  const block = await runningBlock(ctx.db, ctx.userId);
  if (!block || block.id !== blockId || !block.inWindow) return { skip: 'block_closed' };
  return {
    subject: 'Goed bezig',
    silent: true,
    message: {
      text: fill(WINDOW_TEXTS.quietCheck, { einde: localTime(ctx.timezone, block.endsAt) }),
      buttons: [{ id: `blk:${block.id}:stop`, title: WINDOW_BUTTONS.stopNow }],
    },
  };
}

/** 10 minutes before an appointment or quiet hours, while a block runs: write down where you are. */
export async function composeSoftLanding(ctx: NudgeCtx, windowId: number, title: string | null): Promise<Composed> {
  const block = await runningBlock(ctx.db, ctx.userId);
  if (!block) return { skip: 'no_block' };
  const state = await getState(ctx.db, ctx.userId, ctx.now);
  if (state.mode === 'session') await setState(ctx.db, ctx.userId, 'session', { ...state.data, landing: true }, state.expiresAt ?? block.endsAt);
  return {
    subject: 'Zachte landing',
    message: {
      text: fill(WINDOW_TEXTS.softLanding, { afspraak: title ?? WINDOW_TEXTS.quietHours }),
      buttons: [{ id: `fw:${windowId}:skip`, title: WINDOW_BUTTONS.skip }],
    },
  };
}

/** No start 30 minutes into the window: one silent offer to move the task. No repeat, no count. */
export async function composeWindowMissed(ctx: NudgeCtx, windowId: number): Promise<Composed> {
  const window = await getWindow(ctx.db, ctx.userId, windowId);
  if (!window || window.status !== 'planned' || window.startedBlockId) return { skip: 'window_used' };
  // A block started anywhere since the window opened also counts.
  const [started] = await ctx.db
    .select({ id: focusBlocks.id })
    .from(focusBlocks)
    .where(and(eq(focusBlocks.userId, ctx.userId), gt(focusBlocks.startedAt, new Date(window.startsAt.getTime() - 15 * 60_000))))
    .limit(1);
  if (started) return { skip: 'window_used' };
  await ctx.db.update(focusWindows).set({ status: 'missed' }).where(eq(focusWindows.id, window.id));
  const task = await windowTask(ctx, window);
  if (!task) return { skip: 'no_task' };
  const proposal = await nextSlot(ctx, minutesOf(window));
  return {
    subject: 'Je focusvenster',
    silent: true,
    message: {
      text: fill(WINDOW_TEXTS.missed, { taak: lowerFirst(task.title), voorstel: proposal.label }),
      buttons: [
        { id: `fw:${window.id}:yes:${proposal.code}`, title: WINDOW_BUTTONS.yes },
        { id: `fw:${window.id}:no`, title: WINDOW_BUTTONS.notToday },
      ],
    },
  };
}

/** The next free hour today before the wrap-up, or tomorrow at the user's own time. */
async function nextSlot(ctx: NudgeCtx, minutes: number): Promise<{ label: string; code: string }> {
  const settings = await getSettings(ctx.db, ctx.userId);
  const today = localDate(ctx.timezone, ctx.now);
  const local = DateTime.fromJSDate(ctx.now, { zone: ctx.timezone });
  const from = local.plus({ minutes: 30 - (local.minute % 30) }).startOf('minute');
  const until = DateTime.fromISO(`${today}T${settings.wrapupTime.slice(0, 5)}`, { zone: ctx.timezone });
  const slot = until > from ? firstFreeSlot(from.toJSDate(), until.toJSDate(), await todaysEvents(ctx), Math.min(60, minutes)) : undefined;
  if (slot) {
    const time = localTime(ctx.timezone, slot.start);
    return { label: `vandaag ${time}`, code: `t${time.replace(':', '')}` };
  }
  const tomorrow = DateTime.fromISO(today).plus({ days: 1 }).toISODate() ?? today;
  const own = await windowStartFor(ctx.db, ctx.userId, tomorrow);
  return { label: `morgen ${own}`, code: `m${own.replace(':', '')}` };
}

async function windowStartFor(db: Database, userId: number, date: string): Promise<string> {
  return chooseWindow(await windowInput(db, userId, date)).start;
}

// ---------------------------------------------------------------------------
// Buttons

async function askMove(window: WindowRow): Promise<OutboundMessage> {
  return {
    text: WINDOW_TEXTS.moveAsk,
    buttons: [
      { id: `fw:${window.id}:shift`, title: WINDOW_BUTTONS.inHour },
      { id: `fw:${window.id}:tomorrow`, title: WINDOW_BUTTONS.tomorrow },
    ],
  };
}

function movedText(ctx: Ctx, row: WindowRow): OutboundMessage {
  const today = localDate(ctx.timezone, ctx.now);
  return {
    text: fill(WINDOW_TEXTS.moved, {
      dag: row.date === today ? 'vandaag' : 'morgen',
      start: localTime(ctx.timezone, row.startsAt),
      eind: localTime(ctx.timezone, row.endsAt),
    }),
  };
}

const tomorrowOf = (ctx: Ctx) => DateTime.fromISO(localDate(ctx.timezone, ctx.now)).plus({ days: 1 }).toISODate() ?? localDate(ctx.timezone, ctx.now);

/**
 * fp:{pref|ask} · fw:{window}:{start|move|shift|tomorrow|no|skip} · fw:{window}:yes:{t|m}HHMM ·
 * rh:yes:HHMM:{weekdays} · rh:keep. Starting in the window goes through the block buttons.
 */
export function focusWindowButtons(startInWindow: (ctx: ButtonContext, taskId: number) => Promise<OutboundMessage[]>): ButtonExtension {
  return async (button: ParsedButton, ctx) => {
    if (button.kind === 'pref') return [button.pref === 'ask' ? PREF_QUESTION : await savePref(ctx, button.pref)];
    if (button.kind === 'rhythm') {
      if (button.action === 'keep') {
        await recordEvent(ctx.db, ctx.userId, 'rhythm_kept', { asked: true }, ctx.now);
        return [{ text: WINDOW_TEXTS.learnedKeep }];
      }
      await acceptRhythm(ctx.db, ctx.userId, { start: button.start, weekdays: button.weekdays }, ctx.now);
      return [{ text: WINDOW_TEXTS.learnedYes }];
    }
    if (button.kind !== 'window') return undefined;
    const window = await getWindow(ctx.db, ctx.userId, button.windowId);
    if (!window) return [{ text: 'Dat venster kan ik niet meer vinden.' }];
    switch (button.action) {
      case 'start':
        return window.taskId ? startInWindow(ctx, window.taskId) : [{ text: 'Er staat geen taak in je venster.' }];
      case 'move':
        return [await askMove(window)];
      case 'shift': {
        const start = toTime(Math.max(toMinutes(localTime(ctx.timezone, window.startsAt)), toMinutes(localTime(ctx.timezone, ctx.now))) + 60);
        return [movedText(ctx, await moveWindow(ctx, window.date, start))];
      }
      case 'tomorrow':
        return [movedText(ctx, await moveWindow(ctx, tomorrowOf(ctx), undefined, window.taskId))];
      case 'yes': {
        const code = button.value ?? '';
        const time = `${code.slice(1, 3)}:${code.slice(3, 5)}`;
        const task = window.taskId ? await getTask(ctx.db, ctx.userId, window.taskId) : undefined;
        if (code.startsWith('m')) {
          if (task) await carryOver(ctx.db, ctx.userId, task.id, startOfNextLocalDay(ctx.timezone, ctx.now));
          await moveWindow(ctx, tomorrowOf(ctx), time, window.taskId);
        } else {
          await moveWindow(ctx, window.date, time);
        }
        const label = `${code.startsWith('m') ? 'morgen' : 'vandaag'} ${time}`;
        return [{ text: task ? fill(WINDOW_TEXTS.movedTask, { taak: task.title, voorstel: label }) : movedText(ctx, window).text }];
      }
      case 'no':
        return [{ text: WINDOW_TEXTS.notToday }];
      case 'skip': {
        const state = await getState(ctx.db, ctx.userId, ctx.now);
        if (state.mode === 'session' && state.data.landing) {
          await setState(ctx.db, ctx.userId, 'session', { ...state.data, landing: false }, state.expiresAt ?? new Date(ctx.now.getTime() + 3_600_000));
        }
        return [{ text: 'Prima.' }];
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Soft landing: the sentence goes with the task and shows at the next start

/** In a block after the soft landing, the next text is where you are. */
export async function landingModeHandler(text: string, data: Record<string, unknown>, ctx: Ctx): Promise<OutboundMessage[] | undefined> {
  if (data.landing !== true || typeof data.taskId !== 'number') return undefined;
  const sentence = text.trim().slice(0, 500);
  await updateTaskDetails(ctx.db, ctx.userId, data.taskId, { appendNote: `${localDate(ctx.timezone, ctx.now)} Waar je was: ${sentence}` });
  await recordEvent(ctx.db, ctx.userId, 'soft_landing_note', { taskId: data.taskId, text: sentence }, ctx.now);
  await setState(ctx.db, ctx.userId, 'session', { ...data, landing: false }, new Date(ctx.now.getTime() + 3_600_000));
  return [{ text: WINDOW_TEXTS.landingSaved }];
}

/** "Waar je was: …" for the start message, when the last landing note is newer than the last block. */
export async function whereYouWere(db: Database, userId: number, taskId: number): Promise<string | undefined> {
  const [note] = await db
    .select({ props: events.props, at: events.createdAt })
    .from(events)
    .where(and(eq(events.userId, userId), eq(events.name, 'soft_landing_note')))
    .orderBy(desc(events.createdAt), desc(events.id))
    .limit(5)
    .then((rows) => rows.filter((row) => row.props.taskId === taskId));
  if (!note) return undefined;
  const [later] = await db
    .select({ id: focusBlocks.id })
    .from(focusBlocks)
    .where(and(eq(focusBlocks.userId, userId), eq(focusBlocks.taskId, taskId), gt(focusBlocks.startedAt, note.at)))
    .limit(1);
  return later ? undefined : fill(WINDOW_TEXTS.whereYouWere, { zin: String(note.props.text) });
}

// ---------------------------------------------------------------------------
// Learned window (A2): one proposal after the weekly review

export async function rhythmProposalMessage(ctx: NudgeCtx): Promise<OutboundMessage | undefined> {
  const proposal = await rhythmProposal(ctx.db, ctx.userId, ctx.timezone, ctx.now);
  if (!proposal) return undefined;
  await recordEvent(ctx.db, ctx.userId, 'rhythm_proposed', { asked: true, ...proposal }, ctx.now);
  const names = proposal.weekdays.map((d) => WEEKDAY_NAMES[d - 1] ?? '');
  const { workDays } = await getSettings(ctx.db, ctx.userId);
  const dagen = proposal.weekdays.join() === normalizeDays(workDays).join() ? 'werkdagen' : joinDutch(names);
  return {
    text: fill(WINDOW_TEXTS.learned, { dagen, tijd: proposal.start }),
    buttons: [
      { id: `rh:yes:${proposal.start.replace(':', '')}:${proposal.weekdays.join('')}`, title: WINDOW_BUTTONS.yes },
      { id: 'rh:keep', title: WINDOW_BUTTONS.keep },
    ],
  };
}

function joinDutch(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} en ${items.at(-1)}`;
}

// ---------------------------------------------------------------------------
// Router tools

const setFocusPrefTool = defineTool({
  name: 'set_focus_pref',
  description:
    'Wanneer werkt de gebruiker het best ("mijn focus is \'s middags")? pref: morning, afternoon, evening of unknown. ' +
    'Zonder pref ("mijn ritme") stel ik de vraag opnieuw.',
  input: z.object({ pref: z.enum(['morning', 'afternoon', 'evening', 'unknown']).optional() }),
  async run(input, ctx) {
    if (!input.pref) return { content: 'Vraag gesteld.', reply: PREF_QUESTION };
    return { content: `Voorkeur ${input.pref} opgeslagen.`, reply: await savePref(ctx, input.pref) };
  },
});

const moveFocusWindowTool = defineTool({
  name: 'move_focus_window',
  description:
    'Verzet het focusvenster ("focus vandaag om 14:00", "schuif mijn focusvenster naar morgen"). date als YYYY-MM-DD; ' +
    'time als HH:MM, weglaten voor de eigen tijd van de gebruiker.',
  input: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
  }),
  async run(input, ctx) {
    const today = localDate(ctx.timezone, ctx.now);
    if (input.date < today) return { content: 'Die datum is al voorbij.', isError: true };
    const current = await windowFor(ctx.db, ctx.userId, today);
    const row = await moveWindow(ctx, input.date, input.time, input.date === today ? undefined : (current?.taskId ?? null));
    return { content: 'Venster verzet.', reply: movedText(ctx, row) };
  },
});

export const FOCUS_WINDOW_TOOLS: ToolDefinition[] = [setFocusPrefTool, moveFocusWindowTool];
