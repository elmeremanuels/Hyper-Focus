// The work week (step 1.12, on request): which days and hours someone works. The focus window
// stays inside the work hours, nothing proactive comes on other days, and the weekly review
// falls at the end of the last work day.
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { recordEvent } from '../core/events.js';
import { getSettings } from '../core/settings.js';
import type { Database } from '../db/client.js';
import { events, userSettings } from '../db/schema/index.js';
import { dayName, describeDays, lastWorkday, normalizeDays, parseDays } from '../focus/workweek.js';
import { WORK_WEEK_TEXTS } from '../texts/focusvenster.nl.js';
import { fill } from '../texts/werkblokken.nl.js';
import type { ButtonExtension, ParsedButton } from './buttons.js';
import { defineTool, type ToolDefinition } from './tools.js';
import type { OutboundMessage } from './types.js';

export const DAYS_QUESTION: OutboundMessage = {
  text: WORK_WEEK_TEXTS.askDays,
  buttons: [
    { id: 'ww:d:12345', title: 'Ma t/m vr' },
    { id: 'ww:d:1234', title: 'Ma t/m do' },
    { id: 'ww:d:23456', title: 'Di t/m za' },
    { id: 'ww:other', title: 'Anders' },
  ],
};

const HOURS_QUESTION: OutboundMessage = {
  text: WORK_WEEK_TEXTS.askHours,
  buttons: [
    { id: 'ww:h:0800-1600', title: '8–16' },
    { id: 'ww:h:0900-1700', title: '9–17' },
    { id: 'ww:h:1000-1800', title: '10–18' },
    { id: 'ww:other', title: 'Anders' },
  ],
};

interface WorkWeekPatch {
  days?: number[] | undefined;
  start?: string | undefined;
  end?: string | undefined;
}

/** Saves what is given and confirms the whole week, with the day of the weekly review. */
export async function saveWorkWeek(ctx: { db: Database; userId: number; now: Date }, patch: WorkWeekPatch): Promise<OutboundMessage> {
  await ctx.db
    .update(userSettings)
    .set({
      ...(patch.days && { workDays: normalizeDays(patch.days) }),
      ...(patch.start && { workStart: patch.start }),
      ...(patch.end && { workEnd: patch.end }),
    })
    .where(eq(userSettings.userId, ctx.userId));
  await recordEvent(ctx.db, ctx.userId, 'work_week_set', { ...patch }, ctx.now);
  const settings = await getSettings(ctx.db, ctx.userId);
  const end = settings.workEnd.slice(0, 5);
  return {
    text: fill(WORK_WEEK_TEXTS.saved, {
      dagen: describeDays(settings.workDays),
      start: settings.workStart.slice(0, 5),
      eind: end,
      dag: dayName(lastWorkday(settings.workDays)),
    }),
  };
}

/** Existing users get the questions once, on a morning after the focus question. `record: false` only checks. */
export async function workWeekQuestionOnce(db: Database, userId: number, now: Date, record = true): Promise<OutboundMessage | undefined> {
  const [asked] = await db.select({ id: events.id }).from(events).where(and(eq(events.userId, userId), eq(events.name, 'work_week_asked'))).limit(1);
  if (asked) return undefined;
  const [set] = await db.select({ id: events.id }).from(events).where(and(eq(events.userId, userId), eq(events.name, 'work_week_set'))).limit(1);
  if (set) return undefined;
  if (record) await recordEvent(db, userId, 'work_week_asked', {}, now);
  return DAYS_QUESTION;
}

/** ww:ask · ww:d:{weekdays} (then the hours) · ww:h:HHMM-HHMM · ww:other */
export function workWeekButtons(): ButtonExtension {
  return async (button: ParsedButton, ctx) => {
    if (button.kind !== 'workweek') return undefined;
    switch (button.action) {
      case 'ask':
        return [DAYS_QUESTION];
      case 'other':
        return [{ text: WORK_WEEK_TEXTS.other }];
      case 'days':
        await saveWorkWeek(ctx, { days: parseDays(button.value) });
        return [HOURS_QUESTION];
      case 'hours': {
        const [start, end] = button.value.split('-').map((t) => `${t.slice(0, 2)}:${t.slice(2, 4)}`);
        return [await saveWorkWeek(ctx, { start, end })];
      }
    }
  };
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const setWorkWeekTool = defineTool({
  name: 'set_work_week',
  description:
    'De werkdagen en werktijden van de gebruiker ("ik werk ma t/m do van 8 tot 15", "vrijdag ben ik vrij"). days als ISO-weekdagen ' +
    '(1 = maandag … 7 = zondag), start en end als HH:MM. Geef alleen wat genoemd is. Zonder iets ("mijn werkweek") stel ik de vraag.',
  input: z.object({ days: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(), start: time.optional(), end: time.optional() }),
  async run(input, ctx) {
    if (!input.days && !input.start && !input.end) return { content: 'Vraag gesteld.', reply: DAYS_QUESTION };
    if (input.start && input.end && input.start >= input.end) return { content: 'De eindtijd moet na de begintijd liggen.', isError: true };
    return { content: 'Werkweek opgeslagen.', reply: await saveWorkWeek(ctx, input) };
  },
});

export const WORK_WEEK_TOOLS: ToolDefinition[] = [setWorkWeekTool];
