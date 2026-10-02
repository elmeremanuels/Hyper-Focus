// Apple iCloud Calendar over CalDAV, read-only (decision 12, BOUWPLAN v1.5). The user
// creates an app-specific password at appleid.apple.com; we store it encrypted.
import { DateTime } from 'luxon';
import {
  CalendarAuthError,
  dateToUtc,
  type CalendarProvider,
  type Credentials,
  type FetchLike,
  type ListResult,
  type ProviderEvent,
} from './types.js';

export const ICLOUD_CALDAV = 'https://caldav.icloud.com';

export class AppleCalendarProvider implements CalendarProvider {
  readonly name = 'apple' as const;

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly baseUrl = ICLOUD_CALDAV,
  ) {}

  /** Checks the login and finds the event calendars. Throws CalendarAuthError on a bad password. */
  async discover(username: string, password: string): Promise<string[]> {
    const auth = basic(username, password);
    const principalXml = await this.propfind(this.baseUrl, auth, '0', '<d:current-user-principal/>');
    const principal = hrefIn(principalXml, 'current-user-principal');
    if (!principal) throw new Error('CalDAV: no principal');

    const principalUrl = resolve(principal, this.baseUrl);
    const homeXml = await this.propfind(principalUrl, auth, '0', '<c:calendar-home-set/>');
    const home = hrefIn(homeXml, 'calendar-home-set');
    if (!home) throw new Error('CalDAV: no calendar home');

    // iCloud moves to a partition host here (pNN-caldav.icloud.com); later hrefs resolve against it.
    const homeUrl = resolve(home, principalUrl);
    const listXml = await this.propfind(homeUrl, auth, '1', '<d:resourcetype/><c:supported-calendar-component-set/>');
    return responses(listXml)
      .filter((r) => /<(\w+:)?calendar[\s/>]/.test(r) && (!/supported-calendar-component-set/.test(r) || /name="VEVENT"/.test(r)))
      .map((r) => tagText(r, 'href'))
      .filter((href): href is string => Boolean(href))
      .map((href) => resolve(href, homeUrl));
  }

  async listEvents(credentials: Credentials, from: Date, to: Date): Promise<ListResult> {
    if (!credentials.username || !credentials.password) throw new CalendarAuthError('No Apple credentials');
    const auth = basic(credentials.username, credentials.password);
    const calendars = credentials.calendars?.length ? credentials.calendars : await this.discover(credentials.username, credentials.password);

    const range = `start="${caldavTime(from)}" end="${caldavTime(to)}"`;
    const body =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
      `<d:prop><c:calendar-data><c:expand ${range}/></c:calendar-data></d:prop>` +
      `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range ${range}/></c:comp-filter></c:comp-filter></c:filter>` +
      '</c:calendar-query>';

    const events: ProviderEvent[] = [];
    for (const calendar of calendars) {
      const response = await this.fetchImpl(calendar, {
        method: 'REPORT',
        headers: { Authorization: auth, Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
        body,
      });
      if (response.status === 401 || response.status === 403) throw new CalendarAuthError(`CalDAV ${response.status}`);
      if (!response.ok && response.status !== 207) throw new Error(`CalDAV REPORT ${response.status}`);
      for (const data of calendarData(await response.text())) {
        events.push(...parseIcs(data).filter((e) => e.endsAt > from && e.startsAt < to));
      }
    }
    return { events };
  }

  /** App-specific passwords are revoked by the user at appleid.apple.com. */
  async revoke(): Promise<void> {}

  private async propfind(url: string, auth: string, depth: '0' | '1', props: string): Promise<string> {
    const response = await this.fetchImpl(url, {
      method: 'PROPFIND',
      headers: { Authorization: auth, Depth: depth, 'Content-Type': 'application/xml; charset=utf-8' },
      body: `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop>${props}</d:prop></d:propfind>`,
    });
    if (response.status === 401 || response.status === 403) throw new CalendarAuthError(`CalDAV ${response.status}`);
    if (!response.ok && response.status !== 207) throw new Error(`CalDAV PROPFIND ${response.status}`);
    return response.text();
  }
}

function resolve(href: string, base: string): string {
  return new URL(href, base).toString();
}

function basic(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

function caldavTime(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// Minimal XML helpers: CalDAV servers use different namespace prefixes.
function responses(xml: string): string[] {
  return xml.match(/<(\w+:)?response[\s>][\s\S]*?<\/(\w+:)?response>/g) ?? [];
}

function tagText(xml: string, tag: string): string | undefined {
  return new RegExp(`<(?:\\w+:)?${tag}[^>]*>([^<]*)</(?:\\w+:)?${tag}>`).exec(xml)?.[1]?.trim();
}

function hrefIn(xml: string, parent: string): string | undefined {
  const block = new RegExp(`<(?:\\w+:)?${parent}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${parent}>`).exec(xml)?.[1];
  return block ? tagText(block, 'href') : undefined;
}

function calendarData(xml: string): string[] {
  return [...xml.matchAll(/<(?:\w+:)?calendar-data[^>]*>([\s\S]*?)<\/(?:\w+:)?calendar-data>/g)].map((m) =>
    decodeXml(m[1] ?? ''),
  );
}

function decodeXml(value: string): string {
  return value
    .replace(/^<!\[CDATA\[|\]\]>$/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#13;/g, '\r')
    .replace(/&amp;/g, '&');
}

/** Parses the VEVENTs of an iCalendar text. Recurring events arrive expanded by the server. */
export function parseIcs(ics: string): ProviderEvent[] {
  const lines = ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events: ProviderEvent[] = [];
  let current: Map<string, { params: string; value: string }> | undefined;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') current = new Map();
    else if (line === 'END:VEVENT' && current) {
      const event = toEvent(current);
      if (event) events.push(event);
      current = undefined;
    } else if (current) {
      const match = /^([A-Z-]+)((?:;[^:]*)?):(.*)$/.exec(line);
      if (match?.[1] && !current.has(match[1])) current.set(match[1], { params: match[2] ?? '', value: match[3] ?? '' });
    }
  }
  return events;
}

function toEvent(props: Map<string, { params: string; value: string }>): ProviderEvent | undefined {
  if (props.get('STATUS')?.value === 'CANCELLED') return undefined;
  const start = props.get('DTSTART');
  if (!start) return undefined;
  const isAllDay = /VALUE=DATE(;|$)/.test(start.params) || /^\d{8}$/.test(start.value);
  const startsAt = icsTime(start.params, start.value, isAllDay);
  const end = props.get('DTEND');
  let endsAt = end ? icsTime(end.params, end.value, isAllDay) : undefined;
  const duration = props.get('DURATION')?.value;
  if (!endsAt && startsAt) {
    endsAt = duration
      ? DateTime.fromJSDate(startsAt).plus(isoDuration(duration)).toJSDate()
      : new Date(startsAt.getTime() + (isAllDay ? 86_400_000 : 0));
  }
  if (!startsAt || !endsAt) return undefined;

  const uid = props.get('UID')?.value ?? `${start.value}`;
  const recurrence = props.get('RECURRENCE-ID')?.value;
  return {
    externalId: recurrence ? `${uid}:${recurrence}` : `${uid}:${start.value}`,
    startsAt,
    endsAt,
    title: unescapeText(props.get('SUMMARY')?.value ?? '') || '(zonder titel)',
    isAllDay,
    isBusy: props.get('TRANSP')?.value !== 'TRANSPARENT',
  };
}

function icsTime(params: string, value: string, isAllDay: boolean): Date | undefined {
  if (isAllDay) {
    const date = /^(\d{4})(\d{2})(\d{2})/.exec(value);
    return date ? dateToUtc(`${date[1]}-${date[2]}-${date[3]}`) : undefined;
  }
  const zone = value.endsWith('Z') ? 'utc' : (/TZID=([^;:]+)/.exec(params)?.[1] ?? 'utc');
  const parsed = DateTime.fromFormat(value.replace(/Z$/, ''), "yyyyMMdd'T'HHmmss", { zone });
  return parsed.isValid ? parsed.toJSDate() : undefined;
}

function isoDuration(value: string): Record<string, number> {
  const match = /^-?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!match) return {};
  const [, w, d, h, m, s] = match.map((part) => Number(part ?? 0));
  return { weeks: w ?? 0, days: d ?? 0, hours: h ?? 0, minutes: m ?? 0, seconds: s ?? 0 };
}

function unescapeText(value: string): string {
  return value.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
}
