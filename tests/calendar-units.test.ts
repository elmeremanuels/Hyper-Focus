import { describe, expect, it, vi } from 'vitest';
import { AppleCalendarProvider, parseIcs } from '../src/integrations/calendar/apple.js';
import { GoogleCalendarProvider, mapGoogleEvent } from '../src/integrations/calendar/google.js';
import { mapGraphEvent, MicrosoftCalendarProvider } from '../src/integrations/calendar/microsoft.js';
import { createConnectToken, verifyConnectToken } from '../src/integrations/calendar/state.js';
import { CalendarAuthError } from '../src/integrations/calendar/types.js';
import { busyBlocks, daySummary, firstFreeSlot, fitFocus, freeBlocks, meetingAt, type DayEvent } from '../src/proactive/daycalendar.js';

const at = (time: string) => new Date(`2026-10-07T${time}:00Z`);
const event = (start: string, end: string, overrides: Partial<DayEvent> = {}): DayEvent => ({
  startsAt: at(start),
  endsAt: at(end),
  title: 'Afspraak',
  isBusy: true,
  isAllDay: false,
  ...overrides,
});

describe('free time', () => {
  // Window 06:30–14:00 UTC is 08:30–16:00 in Amsterdam.
  const from = at('06:30');
  const to = at('14:00');

  it('merges busy blocks and ignores all-day and free events', () => {
    const events = [
      event('08:00', '09:00'),
      event('08:30', '10:00'),
      event('11:00', '11:30', { isBusy: false }),
      { ...event('00:00', '00:00'), startsAt: new Date('2026-10-07T00:00:00Z'), endsAt: new Date('2026-10-08T00:00:00Z'), isAllDay: true },
      event('13:30', '15:00'),
    ];
    expect(busyBlocks(events, from, to)).toEqual([
      { start: at('08:00'), end: at('10:00') },
      { start: at('13:30'), end: at('14:00') },
    ]);
    expect(freeBlocks(from, to, busyBlocks(events, from, to))).toEqual([
      { start: at('06:30'), end: at('08:00') },
      { start: at('10:00'), end: at('13:30') },
    ]);
  });

  it('finds the first free slot of a length and the meeting at a time', () => {
    const events = [event('06:30', '07:00'), event('07:20', '09:00')];
    expect(firstFreeSlot(from, to, events, 30)).toEqual({ start: at('09:00'), end: at('14:00') });
    expect(firstFreeSlot(from, to, events, 15)).toEqual({ start: at('07:00'), end: at('07:20') });
    expect(meetingAt(events, at('08:00'))?.endsAt).toEqual(at('09:00'));
    expect(meetingAt(events, at('09:00'))).toBeUndefined();
  });

  it('summarises the day in one line, in local time', () => {
    const events = [
      event('08:00', '09:00'),
      event('09:30', '11:00'),
      { ...event('00:00', '00:00', { title: 'Koningsdag' }), startsAt: new Date('2026-10-07T00:00:00Z'), endsAt: new Date('2026-10-08T00:00:00Z'), isAllDay: true },
    ];
    expect(daySummary(events, 'Europe/Amsterdam', from, to, '2026-10-07')).toBe(
      'Vandaag: Koningsdag. Twee afspraken vandaag, de eerste om 10:00. Tussen 13:00 en 16:00 heb je ruimte.',
    );
    expect(daySummary([], 'Europe/Amsterdam', from, to, '2026-10-07')).toBeUndefined();
  });

  it('fits the focus: two tasks on a busy day, the main task shrinks when even that does not fit', () => {
    const focus = [
      { id: 1, estimatedMinutes: 60 },
      { id: 2, estimatedMinutes: 5 },
      { id: 3, estimatedMinutes: 30 },
    ];
    expect(fitFocus(focus, 450, 0)).toEqual({ taskIds: [1, 2, 3], shrinkMain: false });
    expect(fitFocus(focus, 150, 300)).toEqual({ taskIds: [1, 2], shrinkMain: false });
    expect(fitFocus(focus, 40, 410)).toEqual({ taskIds: [1, 2], shrinkMain: true });
  });
});

describe('Google Calendar', () => {
  it('maps events and leaves out declined and cancelled ones', () => {
    expect(mapGoogleEvent({ id: 'a', summary: 'Call Bakkerij', start: { dateTime: '2026-10-07T10:00:00+02:00' }, end: { dateTime: '2026-10-07T11:00:00+02:00' } })).toEqual([
      { externalId: 'a', startsAt: at('08:00'), endsAt: at('09:00'), title: 'Call Bakkerij', isAllDay: false, isBusy: true },
    ]);
    expect(mapGoogleEvent({ id: 'b', start: { date: '2026-10-07' }, end: { date: '2026-10-08' }, transparency: 'transparent' })[0]).toMatchObject({
      isAllDay: true,
      isBusy: false,
      title: '(zonder titel)',
      startsAt: new Date('2026-10-07T00:00:00Z'),
    });
    expect(mapGoogleEvent({ id: 'c', attendees: [{ self: true, responseStatus: 'declined' }], start: { dateTime: '2026-10-07T10:00:00Z' }, end: { dateTime: '2026-10-07T11:00:00Z' } })).toEqual([]);
    expect(mapGoogleEvent({ id: 'd', status: 'cancelled' })).toEqual([]);
  });

  it('expands recurring events, pages, and never asks for attendee names or addresses', async () => {
    const urls: URL[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      urls.push(new URL(String(url)));
      const page = urls.length === 1 ? { items: [{ id: 'a', start: { dateTime: '2026-10-07T08:00:00Z' }, end: { dateTime: '2026-10-07T09:00:00Z' } }], nextPageToken: 'p2' } : { items: [] };
      return new Response(JSON.stringify(page), { status: 200 });
    });
    const provider = new GoogleCalendarProvider({ clientId: 'x', clientSecret: 'y', redirectUri: 'https://h/cb' }, fetchImpl as typeof fetch);
    const result = await provider.listEvents({ accessToken: 'tok', expiresAt: new Date(Date.now() + 3_600_000) }, at('00:00'), at('23:00'));
    expect(result.events).toHaveLength(1);
    expect(urls[0]?.searchParams.get('singleEvents')).toBe('true');
    expect(urls[0]?.searchParams.get('fields')).toContain('attendees(self,responseStatus)');
    expect(urls[0]?.searchParams.get('fields')).not.toMatch(/email|displayName|description|location/);
    expect(urls[1]?.searchParams.get('pageToken')).toBe('p2');
  });
});

describe('Microsoft Graph', () => {
  it('maps calendarView events in UTC', () => {
    expect(mapGraphEvent({ id: 'm', subject: 'Overleg Boho', showAs: 'busy', start: { dateTime: '2026-10-07T12:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-07T12:30:00.0000000', timeZone: 'UTC' } })).toEqual([
      { externalId: 'm', startsAt: at('12:00'), endsAt: at('12:30'), title: 'Overleg Boho', isAllDay: false, isBusy: true },
    ]);
    expect(mapGraphEvent({ id: 'f', showAs: 'free', start: { dateTime: '2026-10-07T12:00:00' }, end: { dateTime: '2026-10-07T13:00:00' } })[0]?.isBusy).toBe(false);
    expect(mapGraphEvent({ id: 'x', responseStatus: { response: 'declined' } })).toEqual([]);
    expect(mapGraphEvent({ id: 'y', isCancelled: true })).toEqual([]);
  });

  it('refreshes an expired token and asks Graph for UTC', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), ...(init && { init }) });
      if (String(url).includes('/token')) return new Response(JSON.stringify({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 }), { status: 200 });
      return new Response(JSON.stringify({ value: [{ id: 'm', start: { dateTime: '2026-10-07T12:00:00' }, end: { dateTime: '2026-10-07T13:00:00' } }] }), { status: 200 });
    });
    const provider = new MicrosoftCalendarProvider({ clientId: 'c', clientSecret: 's', redirectUri: 'https://h/cb' }, fetchImpl as typeof fetch);
    const result = await provider.listEvents({ accessToken: 'old', refreshToken: 'r1', expiresAt: new Date(0) }, at('00:00'), at('23:00'));
    expect(result.refreshed).toMatchObject({ accessToken: 'new', refreshToken: 'r2' });
    expect(String(calls[0]?.init?.body)).toContain('grant_type=refresh_token');
    expect(calls[1]?.url).toContain('/me/calendarView');
    expect((calls[1]?.init?.headers as Record<string, string>).Prefer).toBe('outlook.timezone="UTC"');
    expect(result.events).toHaveLength(1);
    expect(provider.getAuthUrl('state1')).toContain('scope=offline_access+Calendars.Read');
  });
});

describe('Apple iCloud (CalDAV)', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:1',
    'DTSTART;TZID=Europe/Amsterdam:20261007T100000',
    'DTEND;TZID=Europe/Amsterdam:20261007T110000',
    'SUMMARY:Bellen met Bakkerij De Vries\\, offerte',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:2',
    'DTSTART:20261007T120000Z',
    'DURATION:PT45M',
    'TRANSP:TRANSPARENT',
    'SUMMARY:Lunch met een heel lange titel die over',
    '  twee regels loopt',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:3',
    'DTSTART;VALUE=DATE:20261007',
    'DTEND;VALUE=DATE:20261008',
    'SUMMARY:Vrije dag',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:4',
    'STATUS:CANCELLED',
    'DTSTART:20261007T150000Z',
    'DTEND:20261007T160000Z',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  it('parses timezones, durations, folded lines, all-day and cancelled events', () => {
    expect(parseIcs(ics)).toEqual([
      { externalId: '1:20261007T100000', startsAt: at('08:00'), endsAt: at('09:00'), title: 'Bellen met Bakkerij De Vries, offerte', isAllDay: false, isBusy: true },
      { externalId: '2:20261007T120000Z', startsAt: at('12:00'), endsAt: at('12:45'), title: 'Lunch met een heel lange titel die over twee regels loopt', isAllDay: false, isBusy: false },
      { externalId: '3:20261007', startsAt: new Date('2026-10-07T00:00:00Z'), endsAt: new Date('2026-10-08T00:00:00Z'), title: 'Vrije dag', isAllDay: true, isBusy: true },
    ]);
  });

  function fakeCalDav(password = 'abcd-efgh-ijkl-mnop') {
    const requests: Array<{ method: string; url: string; depth: string | null; body: string }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      requests.push({ method: init?.method ?? 'GET', url: String(url), depth: headers.get('Depth'), body: String(init?.body ?? '') });
      if (headers.get('Authorization') !== `Basic ${Buffer.from(`sam@icloud.invalid:${password}`).toString('base64')}`) {
        return new Response('', { status: 401 });
      }
      const xml = (inner: string) => new Response(`<?xml version="1.0"?><multistatus xmlns="DAV:">${inner}</multistatus>`, { status: 207 });
      if (init?.method === 'PROPFIND' && String(url) === 'https://caldav.invalid/') {
        return xml('<response><href>/</href><propstat><prop><current-user-principal><href>/123/principal/</href></current-user-principal></prop></propstat></response>');
      }
      if (init?.method === 'PROPFIND' && String(url).endsWith('/123/principal/')) {
        return xml('<response><href>/123/principal/</href><propstat><prop><calendar-home-set xmlns="urn:ietf:params:xml:ns:caldav"><href xmlns="DAV:">https://p01-caldav.invalid/123/calendars/</href></calendar-home-set></prop></propstat></response>');
      }
      if (init?.method === 'PROPFIND') {
        return xml(
          '<response><href>/123/calendars/</href><propstat><prop><resourcetype><collection/></resourcetype></prop></propstat></response>' +
            '<response><href>/123/calendars/home/</href><propstat><prop><resourcetype><collection/><C:calendar xmlns:C="urn:ietf:params:xml:ns:caldav"/></resourcetype><C:supported-calendar-component-set xmlns:C="urn:ietf:params:xml:ns:caldav"><C:comp name="VEVENT"/></C:supported-calendar-component-set></prop></propstat></response>' +
            '<response><href>/123/calendars/tasks/</href><propstat><prop><resourcetype><collection/><C:calendar xmlns:C="urn:ietf:params:xml:ns:caldav"/></resourcetype><C:supported-calendar-component-set xmlns:C="urn:ietf:params:xml:ns:caldav"><C:comp name="VTODO"/></C:supported-calendar-component-set></prop></propstat></response>',
        );
      }
      return xml(`<response><href>/123/calendars/home/1.ics</href><propstat><prop><C:calendar-data xmlns:C="urn:ietf:params:xml:ns:caldav">${ics.replace(/&/g, '&amp;')}</C:calendar-data></prop></propstat></response>`);
    });
    return { provider: new AppleCalendarProvider(fetchImpl as typeof fetch, 'https://caldav.invalid/'), requests };
  }

  it('discovers event calendars and reads expanded events in the window', async () => {
    const { provider, requests } = fakeCalDav();
    const calendars = await provider.discover('sam@icloud.invalid', 'abcd-efgh-ijkl-mnop');
    expect(calendars).toEqual(['https://p01-caldav.invalid/123/calendars/home/']);

    const { events } = await provider.listEvents({ username: 'sam@icloud.invalid', password: 'abcd-efgh-ijkl-mnop', calendars }, at('00:00'), at('23:59'));
    expect(events.map((e) => e.title)).toEqual(['Bellen met Bakkerij De Vries, offerte', 'Lunch met een heel lange titel die over twee regels loopt', 'Vrije dag']);
    const report = requests.at(-1);
    expect(report?.method).toBe('REPORT');
    expect(report?.body).toContain('<c:expand start="20261007T000000Z" end="20261007T235900Z"/>');
  });

  it('rejects a wrong app-specific password', async () => {
    const { provider } = fakeCalDav();
    await expect(provider.discover('sam@icloud.invalid', 'wrong')).rejects.toBeInstanceOf(CalendarAuthError);
  });
});

describe('connect link', () => {
  it('is signed for one user and valid for 15 minutes', () => {
    const secret = 'k'.repeat(40);
    const now = new Date('2026-10-07T08:00:00Z');
    const token = createConnectToken(7, secret, now);
    expect(verifyConnectToken(token, secret, new Date('2026-10-07T08:14:00Z'))).toBe(7);
    expect(verifyConnectToken(token, secret, new Date('2026-10-07T08:16:00Z'))).toBeUndefined();
    expect(verifyConnectToken(`${token}x`, secret, now)).toBeUndefined();
    expect(verifyConnectToken(token, 'other'.repeat(8), now)).toBeUndefined();
  });
});
