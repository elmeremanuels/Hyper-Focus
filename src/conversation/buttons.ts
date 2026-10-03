// Buttons, choices and action links are handled without an AI call (BOUWPLAN.md, 9.4, 10.1).
import type { ClaudeClient } from '../ai/claude.js';
import type { Database } from '../db/client.js';
import { getSettings, setPausedUntil } from '../core/settings.js';
import { carryOver, getTask, listOpenTasks, moveTask, setTaskStatus } from '../core/tasks.js';
import { setSuggestionStatus } from '../core/suggestions.js';
import { and, eq } from 'drizzle-orm';
import { dailyFocus } from '../db/schema/index.js';
import { localDate, startOfNextLocalDay } from '../lib/time.js';
import type { Button, OutboundMessage } from './types.js';
import { focusView, openFocusTasks, SHOW_TODAY } from './views.js';

export type ParsedButton =
  | { kind: 'task'; taskId: number; action: 'done' | 'tomorrow' | 'split' | 'park' | 'release' | 'start' | 'unpark' }
  | { kind: 'suggestion'; suggestionId: number; action: 'in_progress' | 'later' | 'done' | 'not_relevant' }
  | { kind: 'focus'; action: 'show' | 'dayoff' | 'adjust' | 'later' | 'carry' | 'alldone' }
  | { kind: 'session'; taskId: number; action: 'done' | 'plus10' | 'stuck' }
  | { kind: 'review'; step: string; value: string }
  | { kind: 'move'; taskId: number; projectId: number }
  | { kind: 'plan'; taskId: number; time: string }
  | { kind: 'block'; action: 'start'; taskId: number; minutes: number }
  | { kind: 'block'; action: 'next'; taskId: number }
  | { kind: 'block'; action: 'stop' | 'done' | 'break' | 'plus15' | 'plus30' | 'back'; blockId: number }
  | { kind: 'rewards'; enabled: boolean }
  | { kind: 'day'; action: 'task'; taskId: number; choice: 'tomorrow' | 'split' | 'park' | 'done' }
  | { kind: 'day'; action: 'rest' | 'close' }
  | { kind: 'day'; action: 'energy'; energy: 'low' | 'normal' | 'high' }
  | { kind: 'defer'; taskId: number; action: 'split' | 'park' | 'keep' }
  | { kind: 'pref'; pref: 'morning' | 'afternoon' | 'evening' | 'unknown' | 'ask' }
  | { kind: 'window'; windowId: number; action: 'start' | 'move' | 'shift' | 'tomorrow' | 'yes' | 'no' | 'skip'; value?: string }
  | { kind: 'rhythm'; action: 'yes'; start: string; weekdays: number[] }
  | { kind: 'rhythm'; action: 'keep' }
  | { kind: 'workweek'; action: 'ask' | 'other' | 'days' | 'hours'; value: string }
  | { kind: 'dashboard' }
  | { kind: 'tools'; action: 'start' | 'missing' | 'pick' | 'skip' | 'other' | 'paste' | 'keep' | 'edit' | 'del'; workType?: string; toolKey?: string }
  | { kind: 'help' };

/** Parses the button ids from BOUWPLAN.md 9.4. */
export function parseButtonId(id: string): ParsedButton | undefined {
  let match = /^t:(\d+):(done|tomorrow|split|park|release|start|unpark)$/.exec(id);
  if (match) return { kind: 'task', taskId: Number(match[1]), action: match[2] as never };
  match = /^s:(\d+):(in_progress|later|done|not_relevant)$/.exec(id);
  if (match) return { kind: 'suggestion', suggestionId: Number(match[1]), action: match[2] as never };
  match = /^f:(show|dayoff|adjust|later|carry|alldone)$/.exec(id);
  if (match) return { kind: 'focus', action: match[1] as never };
  match = /^sess:(\d+):(done|plus10|stuck)$/.exec(id);
  if (match) return { kind: 'session', taskId: Number(match[1]), action: match[2] as never };
  match = /^wr:([a-z0-9_]+):([\w-]+)$/.exec(id);
  if (match) return { kind: 'review', step: match[1] ?? '', value: match[2] ?? '' };
  match = /^mv:(\d+):(\d+)$/.exec(id);
  if (match) return { kind: 'move', taskId: Number(match[1]), projectId: Number(match[2]) };
  match = /^ps:(\d+):([01]\d|2[0-3])([0-5]\d)$/.exec(id);
  if (match) return { kind: 'plan', taskId: Number(match[1]), time: `${match[2]}${match[3]}` };
  match = /^blk:t(\d+):m(\d{2})$/.exec(id);
  if (match) return { kind: 'block', action: 'start', taskId: Number(match[1]), minutes: Number(match[2]) };
  match = /^blk:t(\d+):next$/.exec(id);
  if (match) return { kind: 'block', action: 'next', taskId: Number(match[1]) };
  match = /^blk:(\d+):(stop|done|break|plus15|plus30|back)$/.exec(id);
  if (match) return { kind: 'block', action: match[2] as never, blockId: Number(match[1]) };
  match = /^dr:(\d+):(tomorrow|split|park|done)$/.exec(id);
  if (match) return { kind: 'day', action: 'task', taskId: Number(match[1]), choice: match[2] as never };
  if (id === 'dr:rest' || id === 'dr:close') return { kind: 'day', action: id === 'dr:rest' ? 'rest' : 'close' };
  match = /^dr:e:(low|normal|high)$/.exec(id);
  if (match) return { kind: 'day', action: 'energy', energy: match[1] as never };
  match = /^df:(\d+):(split|park|keep)$/.exec(id);
  if (match) return { kind: 'defer', taskId: Number(match[1]), action: match[2] as never };
  match = /^fp:(morning|afternoon|evening|unknown|ask)$/.exec(id);
  if (match) return { kind: 'pref', pref: match[1] as never };
  match = /^fw:(\d+):(start|move|shift|tomorrow|no|skip)$/.exec(id);
  if (match) return { kind: 'window', windowId: Number(match[1]), action: match[2] as never };
  match = /^fw:(\d+):yes:([tm](?:[01]\d|2[0-3])[0-5]\d)$/.exec(id);
  if (match) return { kind: 'window', windowId: Number(match[1]), action: 'yes', value: match[2] ?? '' };
  match = /^rh:yes:((?:[01]\d|2[0-3])[0-5]\d):([1-7]{1,7})$/.exec(id);
  if (match) {
    const time = match[1] ?? '0000';
    return { kind: 'rhythm', action: 'yes', start: `${time.slice(0, 2)}:${time.slice(2)}`, weekdays: [...(match[2] ?? '')].map(Number) };
  }
  if (id === 'rh:keep') return { kind: 'rhythm', action: 'keep' };
  if (id === 'db:open') return { kind: 'dashboard' };
  if (id === 'ww:ask' || id === 'ww:other') return { kind: 'workweek', action: id === 'ww:ask' ? 'ask' : 'other', value: '' };
  match = /^ww:d:([1-7]{1,7})$/.exec(id);
  if (match) return { kind: 'workweek', action: 'days', value: match[1] ?? '' };
  match = /^ww:h:((?:[01]\d|2[0-3])[0-5]\d-(?:[01]\d|2[0-3])[0-5]\d)$/.exec(id);
  if (match) return { kind: 'workweek', action: 'hours', value: match[1] ?? '' };
  if (id === 'rw:on' || id === 'rw:off') return { kind: 'rewards', enabled: id === 'rw:on' };
  if (id === 'tl:start' || id === 'tl:missing') return { kind: 'tools', action: id === 'tl:start' ? 'start' : 'missing' };
  match = /^tl:([a-z]+):pick:([a-z_]+)$/.exec(id);
  if (match) return { kind: 'tools', action: 'pick', workType: match[1] ?? '', toolKey: match[2] ?? '' };
  match = /^tl:([a-z]+):(skip|other|paste|keep|edit|del)$/.exec(id);
  if (match) return { kind: 'tools', action: match[2] as never, workType: match[1] ?? '' };
  if (id === 'help') return { kind: 'help' };
  return undefined;
}

export interface ButtonContext {
  db: Database;
  userId: number;
  timezone: string;
  now: Date;
  claude?: Pick<ClaudeClient, 'callWithTools'> | undefined;
  /** For the reward mini-app link (step 1.9). */
  appBaseUrl?: string | undefined;
}

/** A later step can take over a button kind (session in 1.4, review in 1.7). */
export type ButtonExtension = (button: ParsedButton, ctx: ButtonContext) => Promise<OutboundMessage[] | undefined>;

/** Help with the rewards switch in its current position (step 1.9). */
export async function helpMessage(ctx: Pick<ButtonContext, 'db' | 'userId'>): Promise<OutboundMessage> {
  const { rewardsEnabled } = await getSettings(ctx.db, ctx.userId);
  return {
    ...HELP_MESSAGE,
    buttons: [
      ...(HELP_MESSAGE.buttons ?? []),
      rewardsEnabled ? { id: 'rw:off', title: 'Beloningen uit' } : { id: 'rw:on', title: 'Beloningen aan' },
    ],
  };
}

export const HELP_MESSAGE: OutboundMessage = {
  text:
    'Stuur een taak, idee of vraag in gewone woorden. "Vandaag" toont je focus. ' +
    '"Mijn tools" zet je werkplek-knoppen klaar. "Mijn ritme" zet je focusvenster. "Mijn werkweek" zet je werkdagen en -tijden.',
  buttons: [SHOW_TODAY, { id: 'tl:start', title: 'Tools instellen' }, { id: 'db:open', title: 'Open dashboard' }],
};

const UNKNOWN: OutboundMessage = { text: 'Die knop ken ik niet.', buttons: [SHOW_TODAY] };
const GONE: OutboundMessage = { text: 'Die taak kan ik niet meer vinden.', buttons: [SHOW_TODAY] };

export async function handleButton(
  id: string,
  ctx: ButtonContext,
  extensions: ButtonExtension[] = [],
): Promise<OutboundMessage[]> {
  const button = parseButtonId(id);
  if (!button) return [UNKNOWN];

  for (const extension of extensions) {
    const handled = await extension(button, ctx);
    if (handled) return handled;
  }

  const { db, userId, timezone, now } = ctx;
  switch (button.kind) {
    case 'help':
      return [await helpMessage(ctx)];

    case 'focus':
      if (button.action === 'show') return [await focusView(db, userId, timezone, now)];
      if (button.action === 'dayoff') {
        await setPausedUntil(db, userId, startOfNextLocalDay(timezone, now));
        return [{ text: 'Vandaag vrij. Morgen ben ik er weer.' }];
      }
      if (button.action === 'later') return [{ text: 'Prima. Ik hou het rustig.' }];
      if (button.action === 'carry' || button.action === 'alldone') {
        return [await finishDay(button.action, ctx)];
      }
      return [await adjustMessage(db, userId, now)];

    case 'move': {
      const task = await getTask(db, userId, button.taskId);
      if (!task || !(await moveTask(db, userId, button.taskId, button.projectId))) return [GONE];
      const moved = await getTask(db, userId, button.taskId);
      return [{ text: `Staat nu bij ${moved?.projectTitle ?? 'het project'}.` }];
    }

    case 'task':
      return [await handleTaskButton(button.taskId, button.action, ctx)];

    case 'suggestion': {
      const status = button.action === 'later' ? 'parked' : button.action;
      const ok = await setSuggestionStatus(db, userId, button.suggestionId, status, null, now);
      if (!ok) return [{ text: 'Die suggestie kan ik niet meer vinden.' }];
      const texts = {
        in_progress: 'Mooi, staat op mee bezig.',
        later: 'Komt later terug.',
        done: 'Gedaan ✔',
        not_relevant: 'Genoteerd: niet relevant.',
      } as const;
      return [{ text: texts[button.action] }];
    }

    case 'session':
    case 'review':
    case 'tools':
    case 'block':
    case 'rewards':
    case 'day':
    case 'defer':
    case 'pref':
    case 'window':
    case 'rhythm':
    case 'workweek':
    case 'dashboard':
    case 'plan':
      return [UNKNOWN];
  }
}

async function handleTaskButton(
  taskId: number,
  action: Extract<ParsedButton, { kind: 'task' }>['action'],
  { db, userId, timezone, now }: ButtonContext,
): Promise<OutboundMessage> {
  const task = await getTask(db, userId, taskId);
  if (!task) return GONE;

  switch (action) {
    case 'done':
      await setTaskStatus(db, userId, taskId, 'done', now);
      return { text: `${task.title} is af.`, buttons: [SHOW_TODAY] };
    case 'tomorrow':
      await carryOver(db, userId, taskId, startOfNextLocalDay(timezone, now));
      return { text: `${task.title} staat klaar voor morgen.` };
    case 'park':
      await setTaskStatus(db, userId, taskId, 'parked', now);
      return { text: `${task.title} staat op je parkeerplaats. Je haalt hem terug met "parkeerplaats".` };
    case 'release':
      await setTaskStatus(db, userId, taskId, 'released', now);
      return { text: `${task.title} is losgelaten.` };
    case 'unpark':
      await setTaskStatus(db, userId, taskId, 'open', now);
      return { text: `${task.title} is terug.`, buttons: [{ id: `t:${taskId}:start`, title: 'Start' }] };
    case 'start':
      await setTaskStatus(db, userId, taskId, 'in_progress', now);
      return { text: `Top. Begin met ${task.title}. Stuur "klaar" als het af is.` };
    case 'split':
      return { text: 'Opknippen komt er in de volgende versie bij.', buttons: [{ id: `t:${taskId}:start`, title: 'Toch starten' }] };
  }
}

/** Wrap-up: everything done, or all open focus tasks to tomorrow (BOUWPLAN.md, 11.2). */
async function finishDay(action: 'carry' | 'alldone', { db, userId, timezone, now }: ButtonContext): Promise<OutboundMessage> {
  const open = await openFocusTasks(db, userId, timezone, now);
  for (const task of open) {
    if (action === 'alldone') await setTaskStatus(db, userId, task.id, 'done', now);
    else await carryOver(db, userId, task.id, startOfNextLocalDay(timezone, now));
  }
  await db
    .update(dailyFocus)
    .set({ wrapupDoneAt: now })
    .where(and(eq(dailyFocus.userId, userId), eq(dailyFocus.localDate, localDate(timezone, now))));
  if (action === 'alldone') return { text: 'Alles af. Tot morgen.' };
  return { text: open.length > 0 ? 'Staat klaar voor morgen. Fijne avond.' : 'Fijne avond.' };
}

async function adjustMessage(db: Database, userId: number, now: Date): Promise<OutboundMessage> {
  const open = await listOpenTasks(db, userId, 8, now);
  if (open.length === 0) return { text: 'Er staat niets open om uit te kiezen.' };
  const choices: Button[] = open.map((task) => ({ id: `t:${task.id}:start`, title: task.title }));
  return { text: 'Waar wil je mee beginnen?', choices };
}
