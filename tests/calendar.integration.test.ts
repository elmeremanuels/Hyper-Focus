import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createAssistantRouter } from '../src/conversation/assistant.js';
import { createDbMessageStore } from '../src/core/messages.js';
import { createDbUserStore } from '../src/core/users.js';
import { calendarConnections, calendarEvents, dailyFocus, scheduledNudges, tasks, userSettings, users } from '../src/db/schema/index.js';
import { createConnectToken } from '../src/integrations/calendar/state.js';
import { saveConnection } from '../src/integrations/calendar/store.js';
import { planDay } from '../src/proactive/planner.js';
import { sendDueNudges } from '../src/proactive/sender.js';
import { appointment, fakeCalendar } from './helpers/calendar.js';
import { scriptedClaude } from './helpers/claude.js';
import { fakeDelivery } from './helpers/delivery.js';
import { startServer } from './helpers/server.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

// All on Wednesday 7 October 2026, Amsterdam (UTC+2). Working day 08:30–16:00 = 06:30–14:00 UTC.
const quiet = { error: () => undefined, warn: () => undefined };

describe.skipIf(!adminUrl)('calendar (integration)', { timeout: 30_000 }, () => {
  const t = useTestDatabase();
  const db = () => t.connection.db;
  const cal = fakeCalendar();
  const focusOn = async (date: string) =>
    (await db().select().from(dailyFocus).where(and(eq(dailyFocus.userId, t.userId), eq(dailyFocus.localDate, date))))[0];
  const nudges = async (kind: string) =>
    (await db().select().from(scheduledNudges).where(eq(scheduledNudges.userId, t.userId))).filter((n) => n.kind === kind);

  it('without a calendar everything works as before', async () => {
    await planDay(db(), t.userId, 'Europe/Amsterdam', new Date('2026-10-05T22:06:00Z'), { calendar: cal.service });
    expect((await focusOn('2026-10-06'))?.taskIds).toHaveLength(3);
    expect(cal.provider.listEvents).not.toHaveBeenCalled();
  });

  it('a day with five hours of appointments has at most two focus tasks, and the morning sums it up', async () => {
    await saveConnection(db(), t.userId, 'google', { accessToken: 'a', refreshToken: 'r', expiresAt: new Date('2027-01-01') }, cal.service.encryptionKey);
    cal.state.events = [
      appointment('m1', '2026-10-07T07:00:00Z', '2026-10-07T09:00:00Z', 'Workshop'), // 09:00–11:00
      appointment('m2', '2026-10-07T10:00:00Z', '2026-10-07T13:00:00Z', 'Call Bakkerij De Vries'), // 12:00–15:00
      appointment('m3', '2026-10-07T09:30:00Z', '2026-10-07T10:00:00Z', 'Lunch', { isBusy: false }),
      appointment('d1', '2026-10-07T00:00:00Z', '2026-10-08T00:00:00Z', 'Koningsdag', { isAllDay: true }),
    ];
    await planDay(db(), t.userId, 'Europe/Amsterdam', new Date('2026-10-06T22:06:00Z'), { calendar: cal.service });
    expect((await focusOn('2026-10-07'))?.taskIds.length).toBeLessThanOrEqual(2);

    // Stored: only the allowed fields, linked to the client by name.
    const stored = await db().select().from(calendarEvents).where(eq(calendarEvents.userId, t.userId));
    expect(stored).toHaveLength(4);
    expect(stored.find((e) => e.externalId === 'm2')?.clientId).not.toBeNull();

    await db().update(users).set({ telegramChatId: 55 }).where(eq(users.id, t.userId));
    const { delivery, telegram } = fakeDelivery(createDbMessageStore(db()));
    await sendDueNudges({ db: db(), delivery, users: createDbUserStore(db()), log: quiet }, new Date('2026-10-07T06:30:30Z'));
    const morning = telegram.sent().find((call) => String(call.body.text).startsWith('Goedemorgen'));
    expect(String(morning?.body.text).split('\n')).toEqual([
      'Goedemorgen. Dit zijn je twee. Vandaag: Koningsdag. Twee afspraken vandaag, de eerste om 09:00. Tussen 11:00 en 12:00 heb je ruimte.',
      // The focus window (step 1.12) moves out of the appointments, to the free hour.
      expect.stringMatching(/^Je focusvenster vandaag: 11:00–12:00\. Daar zet ik .+\.$/),
    ]);
  });

  it('gives a heads-up with open points ten minutes before a client appointment', async () => {
    const [headsUp] = await nudges('meeting_heads_up');
    expect(headsUp?.scheduledForUtc.toISOString()).toBe('2026-10-07T09:50:00.000Z');
    const { delivery, telegram } = fakeDelivery(createDbMessageStore(db()));
    await sendDueNudges({ db: db(), delivery, users: createDbUserStore(db()), log: quiet }, new Date('2026-10-07T09:50:20Z'));
    expect(telegram.sent().at(-1)?.body.text).toMatch(/^Om 12:00 heb je een afspraak met Bakkerij De Vries\. Open: offerte bakkerij afmaken, banner voor de feestdagen\.$/);
  });

  it('moves a proactive message to right after an appointment, or drops it after 90 minutes', async () => {
    // Midday at 13:30 falls in the 12:00–15:00 call: 90 minutes later is exactly the end.
    const task = (await db().select().from(tasks).where(eq(tasks.title, 'Banner voor de feestdagen')))[0]!;
    await db().insert(scheduledNudges).values({ userId: t.userId, kind: 'midday', scheduledForUtc: new Date('2026-10-07T11:30:00Z'), payload: { taskId: task.id, localDate: '2026-10-07' } });
    const { delivery, telegram } = fakeDelivery(createDbMessageStore(db()));
    const deps = { db: db(), delivery, users: createDbUserStore(db()), log: quiet };

    expect((await sendDueNudges(deps, new Date('2026-10-07T11:30:30Z'))).postponed).toBeGreaterThanOrEqual(1);
    const [moved] = (await nudges('midday')).filter((n) => n.payload.localDate === '2026-10-07' && n.status === 'pending');
    expect(moved?.scheduledForUtc.toISOString()).toBe('2026-10-07T13:00:00.000Z');
    await sendDueNudges(deps, new Date('2026-10-07T13:00:10Z'));
    expect(telegram.sent().at(-1)?.body.text).toContain('banner voor de feestdagen');

    // A message at 10:00 (in the 09:00–11:00 workshop) moved past 11:30 is dropped.
    cal.state.events.push(appointment('m4', '2026-10-07T13:30:00Z', '2026-10-07T16:00:00Z', 'Lange sessie'));
    await db().insert(scheduledNudges).values({ userId: t.userId, kind: 'escalation', scheduledForUtc: new Date('2026-10-07T13:40:00Z'), payload: { taskId: task.id, level: 1 } });
    const { syncUserCalendars } = await import('../src/integrations/calendar/sync.js');
    await syncUserCalendars(db(), cal.service, t.userId, 'Europe/Amsterdam', new Date('2026-10-07T13:35:00Z'));
    await sendDueNudges(deps, new Date('2026-10-07T13:40:30Z'));
    const [escalation] = await nudges('escalation');
    expect(escalation).toMatchObject({ status: 'skipped', skipReason: 'in_meeting' });
  });

  it('plans as without a calendar when the sync fails, and says so once in the wrap-up', async () => {
    cal.state.fail = true;
    await planDay(db(), t.userId, 'Europe/Amsterdam', new Date('2026-10-07T22:06:00Z'), { calendar: cal.service });
    expect((await focusOn('2026-10-08'))?.taskIds.length).toBeGreaterThan(0);
    const [connection] = await db().select().from(calendarConnections).where(eq(calendarConnections.userId, t.userId));
    expect(connection?.status).toBe('error');

    const { delivery, telegram } = fakeDelivery(createDbMessageStore(db()));
    await sendDueNudges({ db: db(), delivery, users: createDbUserStore(db()), log: quiet }, new Date('2026-10-08T14:00:20Z'));
    expect(telegram.sent().at(-1)?.body.text).toContain('Je agenda kon ik vandaag niet bijwerken, dus ik plande zonder.');
    cal.state.fail = false;
  });

  it('finds a free slot and plans a session there with one tap', async () => {
    const now = new Date('2026-10-07T07:05:00Z'); // 09:05, in the workshop until 11:00
    const claude = scriptedClaude([{ tools: [{ name: 'find_free_slot', input: { minutes: 60 } }] }]);
    const router = createAssistantRouter({ db: db(), claude, calendar: cal.service, now: () => now });
    const [reply] = await router({ kind: 'text', userId: t.userId, text: 'wanneer heb ik vandaag een uur?' });
    expect(reply?.text).toMatch(/^Vandaag ben je vrij van 11:00 tot 12:00\. Zal ik daar een sessie voor .+ plannen\?$/);
    const button = reply?.buttons?.[0];
    expect(button?.id).toMatch(/^ps:\d+:1100$/);

    const [planned] = await router({ kind: 'button', userId: t.userId, buttonId: button!.id, title: button!.title });
    expect(planned?.text).toBe('Staat gepland. Om 11:00 stuur ik je een seintje. Tik op het bestand om het in je agenda te zetten.');
    const [file] = planned?.attachments ?? [];
    expect(file).toMatchObject({ filename: 'focus-1100.ics', mimeType: 'text/calendar' });
    expect(file?.content).toContain('DTSTART:20261007T090000Z');
    expect(file?.content).toContain('DTEND:20261007T092500Z');
    const session = (await nudges('session_checkin')).find((n) => n.payload.planned === true);
    expect(session?.scheduledForUtc.toISOString()).toBe('2026-10-07T09:00:00.000Z');
  });

  it('"ontkoppel agenda" revokes access and deletes tokens and appointments', async () => {
    const claude = scriptedClaude([{ tools: [{ name: 'disconnect_calendar', input: {} }] }]);
    const router = createAssistantRouter({ db: db(), claude, calendar: cal.service });
    const [reply] = await router({ kind: 'text', userId: t.userId, text: 'ontkoppel agenda' });

    expect(reply?.text).toBe('Je agenda is ontkoppeld. Ik heb de toegang ingetrokken en de tokens en afspraken verwijderd.');
    expect(cal.provider.revoke).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: 'r' }));
    expect(await db().select().from(calendarConnections).where(eq(calendarConnections.userId, t.userId))).toHaveLength(0);
    expect(await db().select().from(calendarEvents).where(eq(calendarEvents.userId, t.userId))).toHaveLength(0);
    expect((await db().select().from(userSettings).where(eq(userSettings.userId, t.userId)))[0]?.calendarEnabled).toBe(false);
  });

  it('connects Apple with an app-specific password, stored encrypted, and Google via OAuth', async () => {
    const notified: string[] = [];
    const server = await startServer(
      createApp({ calendar: { db: db(), service: cal.service, notify: async (_id, text) => void notified.push(text) } }),
    );
    try {
      const token = createConnectToken(t.userId, cal.service.linkSecret!, new Date());
      const choose = await fetch(`${server.baseUrl}/agenda/koppel/${token}`);
      const html = await choose.text();
      expect(html).toContain('Google Agenda');
      expect(html).toContain('Apple iCloud-agenda');
      expect(html).not.toContain('/microsoft"'); // no direct Outlook button without Azure keys

      const bad = await fetch(`${server.baseUrl}/agenda/koppel/${token}/apple`, {
        method: 'POST',
        body: new URLSearchParams({ username: 'sam@icloud.invalid', password: 'wrong' }),
      });
      expect(bad.status).toBe(401);

      const good = await fetch(`${server.baseUrl}/agenda/koppel/${token}/apple`, {
        method: 'POST',
        body: new URLSearchParams({ username: 'sam@icloud.invalid', password: 'abcd-efgh-ijkl-mnop' }),
      });
      expect(good.status).toBe(200);
      const [apple] = await db().select().from(calendarConnections).where(and(eq(calendarConnections.userId, t.userId), eq(calendarConnections.provider, 'apple')));
      expect(apple?.calendarIds).toEqual(['https://p01-caldav.invalid/123/calendars/home/']);
      expect(apple?.refreshTokenEnc).not.toContain('abcd-efgh');
      expect(notified).toEqual(['Je agenda is gekoppeld. Ik plan je dag vanaf nu rond je afspraken.']);

      const redirect = await fetch(`${server.baseUrl}/agenda/koppel/${token}/google`, { redirect: 'manual' });
      expect(redirect.headers.get('location')).toBe(`https://accounts.invalid/auth?state=${token}`);
      const callback = await fetch(`${server.baseUrl}/auth/google/callback?code=abc&state=${encodeURIComponent(token)}`);
      expect(callback.status).toBe(200);
      const [google] = await db().select().from(calendarConnections).where(and(eq(calendarConnections.userId, t.userId), eq(calendarConnections.provider, 'google')));
      expect(google?.refreshTokenEnc).toBeTruthy();
      expect(google?.refreshTokenEnc).not.toContain('refresh-1');

      const expired = createConnectToken(t.userId, cal.service.linkSecret!, new Date(Date.now() - 16 * 60_000));
      expect((await fetch(`${server.baseUrl}/agenda/koppel/${expired}`)).status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('connects any calendar with a secret ICS link and keeps only times and titles', async () => {
    cal.feeds.set(
      'https://feeds.invalid/sam/private.ics',
      [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:x1',
        'DTSTART;TZID=Europe/Amsterdam:20261103T100000',
        'DTEND;TZID=Europe/Amsterdam:20261103T110000',
        'RRULE:FREQ=WEEKLY;BYDAY=TU',
        'SUMMARY:Overleg Boho',
        'DESCRIPTION:geheim',
        'LOCATION:kantoor',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
    );
    const server = await startServer(
      createApp({ calendar: { db: db(), service: cal.service, resolveHost: async () => ['93.184.216.34'], now: () => new Date('2026-11-10T07:00:00Z') } }),
    );
    try {
      const token = createConnectToken(t.userId, cal.service.linkSecret!, new Date('2026-11-10T07:00:00Z'));
      const html = await (await fetch(`${server.baseUrl}/agenda/koppel/${token}`)).text();
      expect(html).toContain('ICS-link');
      expect(html).toContain('Geheim adres in iCal-indeling');
      // Each guide says who can see the link and how to revoke it.
      expect(html.match(/Iedereen met de link kan je afspraken zien\./g)).toHaveLength(3);
      for (const revoke of ['Openbare agenda</em> weer uit', 'Opnieuw instellen', 'Publicatie ongedaan maken']) expect(html).toContain(revoke);

      const post = (url: string) =>
        fetch(`${server.baseUrl}/agenda/koppel/${token}/ics`, { method: 'POST', body: new URLSearchParams({ url }) });
      expect((await post('http://feeds.invalid/x.ics')).status).toBe(400);
      expect((await post('https://feeds.invalid/onbekend.ics')).status).toBe(422);
      // Google's public address and Outlook's HTML page are told apart before any fetch.
      const google = await post('https://calendar.google.com/calendar/ical/sam%40voorbeeld.invalid/public/basic.ics');
      expect([google.status, await google.text()]).toEqual([400, expect.stringContaining('Dit is het openbare adres van Google.')]);
      const outlook = await post('https://outlook.office365.com/owa/calendar/abc@voorbeeld.invalid/def/calendar.html');
      expect([outlook.status, await outlook.text()]).toEqual([400, expect.stringContaining('Dit is de HTML-link van Outlook.')]);
      expect((await post('webcal://feeds.invalid/sam/private.ics')).status).toBe(200);

      const [ics] = await db().select().from(calendarConnections).where(and(eq(calendarConnections.userId, t.userId), eq(calendarConnections.provider, 'ics')));
      expect(ics?.refreshTokenEnc).toBeTruthy();
      expect(ics?.refreshTokenEnc).not.toContain('feeds.invalid');

      const stored = await db().select().from(calendarEvents).where(eq(calendarEvents.connectionId, ics!.id));
      expect(stored.map((e) => [e.title, e.startsAtUtc.toISOString()])).toEqual([['Overleg Boho', '2026-11-10T09:00:00.000Z']]);
      expect(stored[0]?.clientId).not.toBeNull();
      expect(JSON.stringify(stored)).not.toMatch(/geheim|kantoor/);
    } finally {
      await server.close();
    }
  });
});
