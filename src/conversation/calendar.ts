// Calendar tools and the "plan a session" button (BOUWPLAN.md, 10.2 and 11.8).
import { DateTime } from 'luxon';
import { z } from 'zod';
import { getSettings } from '../core/settings.js';
import { getTask } from '../core/tasks.js';
import type { Database } from '../db/client.js';
import { scheduledNudges } from '../db/schema/index.js';
import type { CalendarService } from '../integrations/calendar/service.js';
import { calendarFile } from '../integrations/calendar/ics.js';
import { createConnectToken } from '../integrations/calendar/state.js';
import { credentialsOf, deleteConnections, listConnections } from '../integrations/calendar/store.js';
import { eventsBetween, syncUserCalendars } from '../integrations/calendar/sync.js';
import { localDate, localTimeOnDate } from '../lib/time.js';
import { firstFreeSlot } from '../proactive/daycalendar.js';
import type { ButtonExtension } from './buttons.js';
import { date, defineTool, type ToolDefinition } from './tools.js';
import { todaysFocus } from './views.js';

export const CALENDAR_TEXTS = {
  off: 'De agendakoppeling staat nog niet aan. Vraag de beheerder om hem in te richten.',
  notConnected: 'Je agenda is niet gekoppeld. Stuur "koppel agenda" om dat te doen.',
} as const;

export function connectUrl(service: CalendarService, userId: number, now: Date): string | undefined {
  if (!service.linkSecret || !service.baseUrl) return undefined;
  return `${service.baseUrl.replace(/\/$/, '')}/agenda/koppel/${createConnectToken(userId, service.linkSecret, now)}`;
}

/** Revokes access where the provider allows it, then deletes tokens and events. Returns what was connected. */
export async function disconnectCalendars(db: Database, userId: number, service: CalendarService | undefined) {
  const connections = await listConnections(db, userId);
  for (const connection of connections) {
    const provider = service?.[connection.provider];
    try {
      if (provider) await provider.revoke(credentialsOf(connection, service?.encryptionKey));
    } catch (error) {
      console.error('Revoking calendar access failed:', error instanceof Error ? error.message : error);
    }
  }
  if (connections.length > 0) await deleteConnections(db, userId);
  return connections;
}

const connectCalendar = defineTool({
  name: 'connect_calendar',
  description: 'Stuur een persoonlijke koppellink voor de agenda: Google, Outlook of Apple ("koppel agenda").',
  input: z.object({}),
  async run(_input, ctx) {
    const url = ctx.calendar ? connectUrl(ctx.calendar, ctx.userId, ctx.now) : undefined;
    if (!url) return { content: 'Agenda niet ingericht.', reply: { text: CALENDAR_TEXTS.off } };
    return {
      content: 'Koppellink gestuurd.',
      reply: {
        text: `Open deze link en plak de geheime ICS-link van je agenda. Op de pagina staat waar je die vindt. De link werkt 15 minuten.\n${url}`,
      },
    };
  },
});

const disconnectCalendar = defineTool({
  name: 'disconnect_calendar',
  description: 'Ontkoppel de agenda: trek de toegang in en verwijder tokens en afspraken ("ontkoppel agenda").',
  input: z.object({}),
  async run(_input, ctx) {
    const connections = await disconnectCalendars(ctx.db, ctx.userId, ctx.calendar);
    if (connections.length === 0) return { content: 'Geen koppeling.', reply: { text: 'Er is geen agenda gekoppeld.' } };
    const apple = connections.some((c) => c.provider === 'apple');
    const ics = connections.some((c) => c.provider === 'ics');
    return {
      content: 'Agenda ontkoppeld.',
      reply: {
        text:
          'Je agenda is ontkoppeld. Ik heb de toegang ingetrokken en de tokens en afspraken verwijderd.' +
          (apple ? ' Verwijder ook het app-specifieke wachtwoord op account.apple.com.' : '') +
          (ics ? ' Wil je de ICS-link zelf ongeldig maken, maak dan in je agenda een nieuwe geheime link aan.' : ''),
      },
    };
  },
});

const findFreeSlot = defineTool({
  name: 'find_free_slot',
  description: 'Zoek het eerste vrije blok van de gevraagde lengte in de agenda ("wanneer heb ik vandaag een uur?").',
  input: z.object({
    minutes: z.number().int().min(10).max(240),
    date: date.optional().describe('Dag als YYYY-MM-DD; standaard vandaag.'),
  }),
  async run(input, ctx) {
    if (!ctx.calendar) return { content: 'Agenda niet ingericht.', reply: { text: CALENDAR_TEXTS.off } };
    const connections = await listConnections(ctx.db, ctx.userId);
    if (connections.length === 0) return { content: 'Niet gekoppeld.', reply: { text: CALENDAR_TEXTS.notConnected } };

    const today = localDate(ctx.timezone, ctx.now);
    const day = input.date ?? today;
    const settings = await getSettings(ctx.db, ctx.userId);
    const start = localTimeOnDate(ctx.timezone, day, settings.morningTime);
    const from = day === today && ctx.now > start ? ctx.now : start;
    const to = localTimeOnDate(ctx.timezone, day, settings.wrapupTime);
    if (from >= to) return { content: 'Dag voorbij.', reply: { text: 'Voor vandaag zit de werkdag erop. Zal ik morgen bekijken?' } };

    const stale = connections.some((c) => !c.lastSyncedAt || ctx.now.getTime() - c.lastSyncedAt.getTime() > 15 * 60_000);
    if (stale) await syncUserCalendars(ctx.db, ctx.calendar, ctx.userId, ctx.timezone, ctx.now);
    const events = await eventsBetween(ctx.db, ctx.userId, from, to);
    const slot = firstFreeSlot(from, to, events, input.minutes);
    if (!slot) return { content: 'Geen blok.', reply: { text: `Op die dag vind ik geen vrij blok van ${input.minutes} minuten tussen je ochtend en afronden.` } };

    const time = DateTime.fromJSDate(slot.start, { zone: ctx.timezone }).toFormat('HH:mm');
    const until = DateTime.fromJSDate(slot.end, { zone: ctx.timezone }).toFormat('HH:mm');
    const dayText = day === today ? 'Vandaag' : DateTime.fromISO(day).setLocale('nl').toFormat('cccc d LLLL');
    const [main] = day === today ? await todaysFocus(ctx.db, ctx.userId, ctx.timezone, ctx.now) : [];
    return {
      content: 'Vrij blok gevonden.',
      reply: {
        text: `${dayText} ben je vrij van ${time} tot ${until}.${main ? ` Zal ik daar een sessie voor ${lowerFirst(main.title)} plannen?` : ''}`,
        ...(main && { buttons: [{ id: `ps:${main.id}:${time.replace(':', '')}`, title: `Plan om ${time}` }] }),
      },
    };
  },
});

export const CALENDAR_TOOLS: ToolDefinition[] = [connectCalendar, disconnectCalendar, findFreeSlot];

/** `ps:{taskId}:{HHMM}`: plan a session today at that local time. */
export function planSessionButton(): ButtonExtension {
  return async (button, ctx) => {
    if (button.kind !== 'plan') return undefined;
    const today = localDate(ctx.timezone, ctx.now);
    const at = localTimeOnDate(ctx.timezone, today, `${button.time.slice(0, 2)}:${button.time.slice(2)}`);
    if (at <= ctx.now) return [{ text: 'Dat moment is al voorbij. Zullen we nu beginnen?', buttons: [{ id: `t:${button.taskId}:start`, title: 'Nu starten' }] }];
    await ctx.db.insert(scheduledNudges).values({
      userId: ctx.userId,
      kind: 'session_checkin',
      scheduledForUtc: at,
      payload: { planned: true, taskId: button.taskId, localDate: today },
    });
    const time = `${button.time.slice(0, 2)}:${button.time.slice(2)}`;
    const task = await getTask(ctx.db, ctx.userId, button.taskId);
    const { sessionMinutes } = await getSettings(ctx.db, ctx.userId);
    const file = calendarFile({
      uid: `session-${ctx.userId}-${button.taskId}-${today}-${button.time}@hyper-focus.pro`,
      start: at,
      end: new Date(at.getTime() + sessionMinutes * 60_000),
      title: `Focus: ${task?.title ?? 'sessie'}`,
      description: 'Gepland met Hyper&Focus.',
      now: ctx.now,
    });
    return [
      {
        text: `Staat gepland. Om ${time} stuur ik je een seintje. Tik op het bestand om het in je agenda te zetten.`,
        attachments: [{ filename: `focus-${button.time}.ics`, mimeType: 'text/calendar', content: file }],
      },
    ];
  };
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}
