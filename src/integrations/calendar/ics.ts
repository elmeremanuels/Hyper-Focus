// iCalendar (RFC 5545): reading feeds and writing one-event files (decision 12, v1.5).
// Only start, end, title, busy and status are kept. Attendees, descriptions and locations
// are in a feed but are dropped while parsing and never stored (BOUWPLAN.md, 14).
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { DateTime } from 'luxon';
import rrulePkg from 'rrule';
import {
  CalendarAuthError,
  dateToUtc,
  type CalendarProvider,
  type Credentials,
  type FetchLike,
  type ListResult,
  type ProviderEvent,
} from './types.js';

const { RRule } = rrulePkg;

interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
}

type Component = Property[];

/** Windows zone names that Outlook puts in TZID, mapped to IANA. */
const WINDOWS_ZONES: Record<string, string> = {
  'W. Europe Standard Time': 'Europe/Amsterdam',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'UTC': 'UTC',
  'Singapore Standard Time': 'Asia/Singapore',
  'China Standard Time': 'Asia/Shanghai',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'Eastern Standard Time': 'America/New_York',
  'Pacific Standard Time': 'America/Los_Angeles',
};

export interface ParseOptions {
  /** Only events overlapping [from, to) are returned; recurring events are expanded. */
  from?: Date;
  to?: Date;
  /** Zone for times without TZID or with an unknown one. */
  defaultZone?: string;
  /** The user's addresses: an invitation they declined is left out. */
  selfEmails?: string[];
}

function unfold(ics: string): string[] {
  return ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parseLine(line: string): Property | undefined {
  // NAME;PARAM=a;PARAM="b:c":VALUE — the value starts at the first colon outside quotes.
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ':' && !inQuotes) {
      const [name = '', ...rawParams] = line.slice(0, i).split(';');
      const params: Record<string, string> = {};
      for (const raw of rawParams) {
        const eq = raw.indexOf('=');
        if (eq > 0) params[raw.slice(0, eq).toUpperCase()] = raw.slice(eq + 1).replace(/^"|"$/g, '');
      }
      return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
    }
  }
  return undefined;
}

function events(ics: string): Component[] {
  const found: Component[] = [];
  let current: Component | undefined;
  let depth = 0; // nested components such as VALARM inside VEVENT
  for (const line of unfold(ics)) {
    if (line === 'BEGIN:VEVENT') {
      current = [];
      depth = 0;
    } else if (current && line.startsWith('BEGIN:')) depth += 1;
    else if (current && line.startsWith('END:') && depth > 0) depth -= 1;
    else if (line === 'END:VEVENT' && current) {
      found.push(current);
      current = undefined;
    } else if (current && depth === 0) {
      const prop = parseLine(line);
      if (prop) current.push(prop);
    }
  }
  return found;
}

const get = (c: Component, name: string) => c.find((p) => p.name === name);
const all = (c: Component, name: string) => c.filter((p) => p.name === name);

function zoneOf(prop: Property, fallback: string): string {
  if (prop.value.endsWith('Z')) return 'utc';
  const tzid = prop.params.TZID;
  if (!tzid) return fallback;
  if (DateTime.local().setZone(tzid).isValid) return tzid;
  return WINDOWS_ZONES[tzid] ?? fallback;
}

const isDateOnly = (prop: Property) => prop.params.VALUE === 'DATE' || /^\d{8}$/.test(prop.value);

/** Wall-clock parts of a DATE-TIME or DATE value. */
function wall(value: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/.exec(value);
  if (!m) return undefined;
  const n = (i: number) => Number(m[i] ?? 0);
  return { year: n(1), month: n(2), day: n(3), hour: n(4), minute: n(5), second: n(6) };
}

function instant(prop: Property, value: string, fallback: string): Date | undefined {
  const parts = wall(value);
  if (!parts) return undefined;
  if (isDateOnly(prop)) return dateToUtc(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`);
  const dt = DateTime.fromObject(parts, { zone: value.endsWith('Z') ? 'utc' : zoneOf(prop, fallback) });
  return dt.isValid ? dt.toJSDate() : undefined;
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

/**
 * Parses the VEVENTs of an iCalendar text. With a window, recurring events (RRULE, EXDATE,
 * RECURRENCE-ID overrides) are expanded in their own timezone, so clock changes are right.
 */
export function parseIcs(ics: string, options: ParseOptions = {}): ProviderEvent[] {
  const fallback = options.defaultZone ?? 'utc';
  const self = new Set((options.selfEmails ?? []).map((e) => e.toLowerCase()));
  const comps = events(ics);
  const overrides = new Map<string, Set<number>>();
  for (const c of comps) {
    const rid = get(c, 'RECURRENCE-ID');
    const uid = get(c, 'UID')?.value;
    const at = rid && instant(rid, rid.value, fallback);
    if (uid && at) overrides.set(uid, (overrides.get(uid) ?? new Set()).add(at.getTime()));
  }

  const result: ProviderEvent[] = [];
  for (const c of comps) {
    const start = get(c, 'DTSTART');
    if (!start || get(c, 'STATUS')?.value.toUpperCase() === 'CANCELLED') continue;
    const declined = all(c, 'ATTENDEE').some(
      (a) => a.params.PARTSTAT?.toUpperCase() === 'DECLINED' && self.has(a.value.replace(/^mailto:/i, '').toLowerCase()),
    );
    if (declined) continue;

    const allDay = isDateOnly(start);
    const startsAt = instant(start, start.value, fallback);
    if (!startsAt) continue;
    const end = get(c, 'DTEND');
    const duration = get(c, 'DURATION')?.value;
    const endsAt =
      (end && instant(end, end.value, fallback)) ??
      (duration ? DateTime.fromJSDate(startsAt).plus(isoDuration(duration)).toJSDate() : new Date(startsAt.getTime() + (allDay ? 86_400_000 : 0)));
    const length = endsAt.getTime() - startsAt.getTime();
    const uid = get(c, 'UID')?.value ?? start.value;
    const base = {
      title: unescapeText(get(c, 'SUMMARY')?.value ?? '') || '(zonder titel)',
      isAllDay: allDay,
      isBusy: get(c, 'TRANSP')?.value.toUpperCase() !== 'TRANSPARENT',
    };

    const rrule = get(c, 'RRULE');
    if (!rrule || get(c, 'RECURRENCE-ID') || !options.from || !options.to) {
      const rid = get(c, 'RECURRENCE-ID');
      result.push({ externalId: `${uid}:${rid ? rid.value : start.value}`, startsAt, endsAt, ...base });
      continue;
    }

    // Expand in "floating" wall-clock time (dates as UTC), then place each occurrence in its zone.
    const zone = allDay ? 'utc' : zoneOf(start, fallback);
    const parts = wall(start.value);
    if (!parts) continue;
    const floating = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
    const dtstart = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
    let rule;
    try {
      rule = new RRule({ ...RRule.parseString(rrule.value), dtstart });
    } catch {
      continue;
    }
    const toWall = (d: Date) => DateTime.fromJSDate(d, { zone }).setZone('utc', { keepLocalTime: true }).toJSDate();
    const from = new Date(toWall(options.from).getTime() - length - 86_400_000);
    const to = new Date(toWall(options.to).getTime() + 86_400_000);
    const excluded = new Set(
      all(c, 'EXDATE').flatMap((ex) => ex.value.split(',').map((v) => instant(ex, v, fallback)?.getTime() ?? NaN)),
    );
    const moved = overrides.get(uid) ?? new Set<number>();

    for (const occurrence of rule.between(floating(from), floating(to), true).slice(0, 500)) {
      const at = allDay
        ? occurrence
        : DateTime.fromObject(
            {
              year: occurrence.getUTCFullYear(),
              month: occurrence.getUTCMonth() + 1,
              day: occurrence.getUTCDate(),
              hour: occurrence.getUTCHours(),
              minute: occurrence.getUTCMinutes(),
              second: occurrence.getUTCSeconds(),
            },
            { zone },
          ).toJSDate();
      if (excluded.has(at.getTime()) || moved.has(at.getTime())) continue;
      const stamp = DateTime.fromJSDate(at, { zone: 'utc' }).toFormat("yyyyMMdd'T'HHmmss'Z'");
      result.push({ externalId: `${uid}:${stamp}`, startsAt: at, endsAt: new Date(at.getTime() + length), ...base });
    }
  }

  const { from, to } = options;
  return from && to ? result.filter((e) => e.endsAt > from && e.startsAt < to) : result;
}

// ---------------------------------------------------------------------------
// Feed provider: one secret ICS link works for Google, Outlook, Apple and others.

export const ICS_MAX_BYTES = 10 * 1024 * 1024;
const ICS_TIMEOUT_MS = 15_000;

/** https:// (or webcal://) on a public host; returns the https URL or undefined. */
export async function normalizeIcsUrl(
  input: string,
  resolve: (host: string) => Promise<string[]> = async (host) => (await lookup(host, { all: true })).map((a) => a.address),
): Promise<string | undefined> {
  let url: URL;
  try {
    url = new URL(input.trim().replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return undefined;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return undefined;
  const addresses = isIP(host) ? [host] : await resolve(host).catch(() => []);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) return undefined;
  return url.toString();
}

/** Loopback, private, link-local and unspecified addresses (no server-side requests inward). */
export function isPrivateAddress(address: string): boolean {
  if (address.includes(':')) {
    const a = address.toLowerCase();
    if (a.startsWith('::ffff:')) return isPrivateAddress(a.slice(7));
    return a === '::1' || a === '::' || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80');
  }
  const [a = 0, b = 0] = address.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export class IcsCalendarProvider implements CalendarProvider {
  readonly name = 'ics' as const;

  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async listEvents(credentials: Credentials, from: Date, to: Date): Promise<ListResult> {
    if (!credentials.url) throw new CalendarAuthError('No ICS link');
    const response = await this.fetchImpl(credentials.url, {
      headers: { Accept: 'text/calendar, */*;q=0.5' },
      redirect: 'follow',
      signal: AbortSignal.timeout(ICS_TIMEOUT_MS),
    });
    if ([401, 403, 404, 410].includes(response.status)) throw new CalendarAuthError(`ICS link ${response.status}`);
    if (!response.ok) throw new Error(`ICS link ${response.status}`);
    const size = Number(response.headers.get('content-length') ?? 0);
    if (size > ICS_MAX_BYTES) throw new Error('ICS feed too large');
    const text = await response.text();
    if (text.length > ICS_MAX_BYTES) throw new Error('ICS feed too large');
    if (!text.includes('BEGIN:VCALENDAR')) throw new CalendarAuthError('Not an iCalendar feed');
    return {
      events: parseIcs(text, {
        from,
        to,
        ...(credentials.timezone && { defaultZone: credentials.timezone }),
        ...(credentials.username && { selfEmails: [credentials.username] }),
      }),
    };
  }

  /** The user makes the link invalid by resetting it in their calendar; we delete our copy. */
  async revoke(): Promise<void> {}
}

// ---------------------------------------------------------------------------
// One-event files for the "Zet in agenda" button.

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Folds lines at 75 octets as RFC 5545 asks. */
function fold(line: string): string {
  const parts: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest, 'utf8') > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut), 'utf8') > 75) cut -= 1;
    parts.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  parts.push(rest);
  return parts.join('\r\n');
}

const utcStamp = (d: Date) => DateTime.fromJSDate(d, { zone: 'utc' }).toFormat("yyyyMMdd'T'HHmmss'Z'");

export function calendarFile(event: { uid: string; start: Date; end: Date; title: string; description?: string; now?: Date }): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Hyper&Focus//NL',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${utcStamp(event.now ?? new Date())}`,
    `DTSTART:${utcStamp(event.start)}`,
    `DTEND:${utcStamp(event.end)}`,
    `SUMMARY:${escapeText(event.title)}`,
    ...(event.description ? [`DESCRIPTION:${escapeText(event.description)}`] : []),
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
