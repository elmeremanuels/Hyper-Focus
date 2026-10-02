// Calendar parts of the proactive messages (BOUWPLAN.md, 11.8).
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { getSettings } from '../core/settings.js';
import { getTask, type TaskSummary } from '../core/tasks.js';
import { calendarConnections, clients, projects, tasks } from '../db/schema/index.js';
import { eventsBetween } from '../integrations/calendar/sync.js';
import { localTimeOnDate } from '../lib/time.js';
import type { OutboundMessage } from '../conversation/types.js';
import { daySummary, firstFreeSlot, type DayEvent } from './daycalendar.js';
import type { Composed, NudgeContext } from './messages.js';

/** A session slot offered at midday is at least this long. */
export const SLOT_MINUTES = 30;

async function dayWindow(ctx: NudgeContext, localDate: string) {
  const settings = await getSettings(ctx.db, ctx.userId);
  if (!settings.calendarEnabled) return undefined;
  const from = localTimeOnDate(ctx.timezone, localDate, settings.morningTime);
  const to = localTimeOnDate(ctx.timezone, localDate, settings.wrapupTime);
  const dayStart = DateTime.fromISO(localDate, { zone: ctx.timezone }).startOf('day');
  const events = await eventsBetween(ctx.db, ctx.userId, dayStart.toUTC().toJSDate(), dayStart.plus({ days: 1 }).toUTC().toJSDate());
  return { from, to, events };
}

/** "Twee afspraken vandaag, de eerste om 10:00. Tussen 13:00 en 15:00 heb je ruimte." */
export async function calendarDayLine(ctx: NudgeContext, localDate: string): Promise<string | undefined> {
  const window = await dayWindow(ctx, localDate);
  return window ? daySummary(window.events, ctx.timezone, window.from, window.to, localDate) : undefined;
}

/** Once a day, in the wrap-up: the calendar could not be synced. */
export async function calendarErrorLine(ctx: NudgeContext): Promise<string | undefined> {
  const failing = await ctx.db
    .select({ id: calendarConnections.id })
    .from(calendarConnections)
    .where(and(eq(calendarConnections.userId, ctx.userId), eq(calendarConnections.status, 'error')));
  return failing.length > 0 ? 'Je agenda kon ik vandaag niet bijwerken, dus ik plande zonder.' : undefined;
}

/** Midday with a calendar: the first free block of 30 minutes or more, from now. */
export async function freeSlotOffer(ctx: NudgeContext, localDate: string, task: TaskSummary): Promise<OutboundMessage | undefined> {
  const window = await dayWindow(ctx, localDate);
  if (!window) return undefined;
  const slot = firstFreeSlot(ctx.now, window.to, window.events, SLOT_MINUTES);
  if (!slot) return undefined;
  if (slot.start.getTime() - ctx.now.getTime() < 5 * 60_000) return undefined; // free now: the normal offer
  const time = DateTime.fromJSDate(slot.start, { zone: ctx.timezone }).toFormat('HH:mm');
  const minutes = Math.round((slot.end.getTime() - slot.start.getTime()) / 60_000);
  const length = minutes >= 60 ? 'een vrij uur' : `${minutes} minuten vrij`;
  return {
    text: `Om ${time} heb je ${length}. Zullen we dan ${lowerFirst(task.title)} doen?`,
    buttons: [
      { id: `ps:${task.id}:${time.replace(':', '')}`, title: `Ja, om ${time}` },
      { id: `t:${task.id}:start`, title: 'Nu' },
      { id: 'f:later', title: 'Later' },
    ],
  };
}

async function linkedEvent(ctx: NudgeContext, eventId: string) {
  const dayStart = DateTime.fromJSDate(ctx.now, { zone: ctx.timezone }).startOf('day');
  const events = await eventsBetween(ctx.db, ctx.userId, dayStart.toUTC().toJSDate(), dayStart.plus({ days: 2 }).toUTC().toJSDate());
  const event = events.find((e) => e.externalId === eventId);
  if (!event) return undefined;
  const [client] = event.clientId
    ? await ctx.db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.id, event.clientId))
    : [];
  const [project] = event.projectId
    ? await ctx.db.select({ id: projects.id, title: projects.title }).from(projects).where(eq(projects.id, event.projectId))
    : [];
  return { event, name: client?.name ?? project?.title ?? event.title, clientId: client?.id ?? null, projectId: project?.id ?? null };
}

/** Ten minutes before a linked appointment, with the open points. */
export async function composeHeadsUp(ctx: NudgeContext, eventId: string): Promise<Composed> {
  const linked = await linkedEvent(ctx, eventId);
  if (!linked) return { skip: 'event_gone' };
  const minutesToStart = (linked.event.startsAt.getTime() - ctx.now.getTime()) / 60_000;
  if (minutesToStart < 0 || minutesToStart > 20) return { skip: 'event_moved' };

  const projectIds = linked.projectId
    ? [linked.projectId]
    : linked.clientId
      ? (await ctx.db.select({ id: projects.id }).from(projects).where(eq(projects.clientId, linked.clientId))).map((p) => p.id)
      : [];
  const open = projectIds.length
    ? await ctx.db
        .select({ title: tasks.title })
        .from(tasks)
        .where(and(inArray(tasks.projectId, projectIds), inArray(tasks.status, ['open', 'in_progress']), isNull(tasks.parentTaskId)))
        .limit(3)
    : [];
  const time = DateTime.fromJSDate(linked.event.startsAt, { zone: ctx.timezone }).toFormat('HH:mm');
  const openLine = open.length > 0 ? ` Open: ${open.map((t) => lowerFirst(t.title)).join(', ')}.` : '';
  return { subject: `Om ${time}: ${linked.name}`, message: { text: `Om ${time} heb je een afspraak met ${linked.name}.${openLine}` } };
}

/** Right after a linked appointment: ask for the action points. */
export async function composeFollowup(ctx: NudgeContext, eventId: string): Promise<Composed> {
  const linked = await linkedEvent(ctx, eventId);
  if (!linked) return { skip: 'event_gone' };
  if (ctx.now < linked.event.endsAt) return { skip: 'event_moved' };
  return {
    subject: `Hoe ging het met ${linked.name}?`,
    message: { text: `Hoe ging het met ${linked.name}? Stuur een spraakbericht met de actiepunten, dan zet ik ze klaar.` },
  };
}

/** A session the user planned in a free block ("Ja, om 14:00"). */
export async function composePlannedSession(ctx: NudgeContext, taskId: number): Promise<Composed> {
  const task = await getTask(ctx.db, ctx.userId, taskId);
  if (!task || task.status === 'done' || task.status === 'released') return { skip: 'task_moved' };
  return {
    subject: 'Tijd voor je sessie',
    message: {
      text: `Het is tijd voor ${lowerFirst(task.title)}. Zullen we beginnen?`,
      buttons: [
        { id: `t:${task.id}:start`, title: 'Start' },
        { id: 'f:later', title: 'Later' },
      ],
    },
  };
}

/** Events that move a proactive message (BOUWPLAN.md, 11.8, point 2). */
export async function todaysEvents(ctx: Pick<NudgeContext, 'db' | 'userId' | 'timezone' | 'now'>): Promise<DayEvent[]> {
  const settings = await getSettings(ctx.db, ctx.userId);
  if (!settings.calendarEnabled) return [];
  return eventsBetween(ctx.db, ctx.userId, new Date(ctx.now.getTime() - 12 * 3_600_000), new Date(ctx.now.getTime() + 12 * 3_600_000));
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}
