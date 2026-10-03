import { describe, expect, it, vi } from 'vitest';
import { calendarFile, IcsCalendarProvider, isPrivateAddress, normalizeIcsUrl, parseIcs } from '../src/integrations/calendar/ics.js';
import { CalendarAuthError } from '../src/integrations/calendar/types.js';

const ics = (...events: string[][]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');

// Window: Monday 26 October 2026 (the day after the Dutch clock change) and Tuesday.
const from = new Date('2026-10-25T23:00:00Z');
const to = new Date('2026-10-27T23:00:00Z');

describe('parseIcs with recurring events', () => {
  it('expands a weekly meeting in its own timezone across the clock change', () => {
    const feed = ics([
      'UID:standup',
      'DTSTART;TZID=Europe/Amsterdam:20261005T093000',
      'DTEND;TZID=Europe/Amsterdam:20261005T094500',
      'RRULE:FREQ=WEEKLY;BYDAY=MO',
      'SUMMARY:Standup',
      'ATTENDEE;CN=Collega:mailto:collega@voorbeeld.invalid',
      'DESCRIPTION:wordt niet bewaard',
      'LOCATION:wordt niet bewaard',
    ]);
    const events = parseIcs(feed, { from, to });
    // 09:30 in Amsterdam is 08:30 UTC in winter time (it was 07:30 in October before the change).
    expect(events).toEqual([
      { externalId: 'standup:20261026T083000Z', startsAt: new Date('2026-10-26T08:30:00Z'), endsAt: new Date('2026-10-26T08:45:00Z'), title: 'Standup', isAllDay: false, isBusy: true },
    ]);
    expect(Object.keys(events[0] ?? {})).not.toContain('description');
  });

  it('skips excluded and moved occurrences and adds the moved one', () => {
    const feed = ics(
      [
        'UID:daily',
        'DTSTART:20261020T120000Z',
        'DURATION:PT30M',
        'RRULE:FREQ=DAILY;COUNT=20',
        'EXDATE:20261026T120000Z',
        'SUMMARY:Lunchwandeling',
      ],
      ['UID:daily', 'RECURRENCE-ID:20261027T120000Z', 'DTSTART:20261027T150000Z', 'DTEND:20261027T153000Z', 'SUMMARY:Lunchwandeling (later)'],
    );
    const events = parseIcs(feed, { from, to });
    expect(events.map((e) => [e.title, e.startsAt.toISOString()])).toEqual([['Lunchwandeling (later)', '2026-10-27T15:00:00.000Z']]);
  });

  it('understands Outlook zone names, all-day series, cancelled events and declined invitations', () => {
    const feed = ics(
      ['UID:o1', 'DTSTART;TZID=W. Europe Standard Time:20261026T140000', 'DTEND;TZID=W. Europe Standard Time:20261026T150000', 'SUMMARY:Call Bakkerij De Vries'],
      ['UID:o2', 'DTSTART;VALUE=DATE:20261012', 'DTEND;VALUE=DATE:20261013', 'RRULE:FREQ=WEEKLY', 'SUMMARY:Thuiswerkdag', 'TRANSP:TRANSPARENT'],
      ['UID:o3', 'STATUS:CANCELLED', 'DTSTART:20261026T100000Z', 'DTEND:20261026T110000Z', 'SUMMARY:Vervallen'],
      ['UID:o4', 'DTSTART:20261026T100000Z', 'DTEND:20261026T110000Z', 'SUMMARY:Afgeslagen', 'ATTENDEE;PARTSTAT=DECLINED:mailto:Sam@Voorbeeld.invalid'],
      ['UID:o5', 'DTSTART:20261026T110000Z', 'DTEND:20261026T120000Z', 'SUMMARY:Met herinnering', 'BEGIN:VALARM', 'TRIGGER:-PT10M', 'SUMMARY:alarm', 'END:VALARM'],
    );
    const events = parseIcs(feed, { from, to, selfEmails: ['sam@voorbeeld.invalid'] });
    expect(events.map((e) => [e.title, e.startsAt.toISOString(), e.isAllDay, e.isBusy])).toEqual([
      ['Call Bakkerij De Vries', '2026-10-26T13:00:00.000Z', false, true],
      ['Thuiswerkdag', '2026-10-26T00:00:00.000Z', true, false],
      ['Met herinnering', '2026-10-26T11:00:00.000Z', false, true],
    ]);
  });

  it('uses the user timezone for floating times', () => {
    const feed = ics(['UID:f', 'DTSTART:20261026T090000', 'DTEND:20261026T100000', 'SUMMARY:Bali']);
    expect(parseIcs(feed, { from, to, defaultZone: 'Asia/Makassar' })[0]?.startsAt.toISOString()).toBe('2026-10-26T01:00:00.000Z');
  });
});

describe('ICS link', () => {
  const resolvePublic = async () => ['142.250.0.1'];

  it('accepts https and webcal links on public hosts only', async () => {
    expect(await normalizeIcsUrl('webcal://p01-caldav.icloud.com/published/2/abc', resolvePublic)).toBe('https://p01-caldav.icloud.com/published/2/abc');
    expect(await normalizeIcsUrl(' https://calendar.google.com/calendar/ical/x/private-y/basic.ics ', resolvePublic)).toBe(
      'https://calendar.google.com/calendar/ical/x/private-y/basic.ics',
    );
    expect(await normalizeIcsUrl('http://calendar.google.com/x.ics', resolvePublic)).toBeUndefined();
    expect(await normalizeIcsUrl('https://localhost/x.ics', resolvePublic)).toBeUndefined();
    expect(await normalizeIcsUrl('https://127.0.0.1/x.ics', resolvePublic)).toBeUndefined();
    expect(await normalizeIcsUrl('https://intern.voorbeeld/x.ics', async () => ['10.0.0.5'])).toBeUndefined();
    expect(await normalizeIcsUrl('geen link', resolvePublic)).toBeUndefined();
  });

  it('recognises private addresses', () => {
    expect(['10.1.2.3', '172.20.0.1', '192.168.1.1', '127.0.0.1', '169.254.1.1', '::1', 'fd00::1', '::ffff:10.0.0.1'].every(isPrivateAddress)).toBe(true);
    expect(['8.8.8.8', '17.253.144.10', '2a00:1450::1'].some(isPrivateAddress)).toBe(false);
  });

  it('reads the feed and treats a gone link as a disconnect', async () => {
    const feed = ics(['UID:a', 'DTSTART:20261026T100000Z', 'DTEND:20261026T110000Z', 'SUMMARY:Afspraak']);
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('gone') ? new Response('', { status: 404 }) : String(url).includes('html') ? new Response('<html>') : new Response(feed),
    );
    const provider = new IcsCalendarProvider(fetchImpl as typeof fetch);
    expect((await provider.listEvents({ url: 'https://x.invalid/ok.ics' }, from, to)).events).toHaveLength(1);
    await expect(provider.listEvents({ url: 'https://x.invalid/gone.ics' }, from, to)).rejects.toBeInstanceOf(CalendarAuthError);
    await expect(provider.listEvents({ url: 'https://x.invalid/html' }, from, to)).rejects.toBeInstanceOf(CalendarAuthError);
  });
});

describe('calendarFile', () => {
  it('writes one event that calendars and our own parser read back', () => {
    const file = calendarFile({
      uid: 'session-1@hyper-focus.pro',
      start: new Date('2026-10-26T13:00:00Z'),
      end: new Date('2026-10-26T13:25:00Z'),
      title: 'Focus: offerte; versie 2, met een heel lange titel die over de vijfenzeventig tekens heen loopt',
      now: new Date('2026-10-26T08:00:00Z'),
    });
    expect(file.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(file).toContain('DTSTART:20261026T130000Z\r\nDTEND:20261026T132500Z');
    expect(file.split('\r\n').every((line) => Buffer.byteLength(line, 'utf8') <= 75)).toBe(true);
    const [event] = parseIcs(file);
    expect(event).toMatchObject({ title: 'Focus: offerte; versie 2, met een heel lange titel die over de vijfenzeventig tekens heen loopt', isBusy: true });
    expect(event?.startsAt).toEqual(new Date('2026-10-26T13:00:00Z'));
  });
});
