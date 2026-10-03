// Apple iCloud Calendar over CalDAV, read-only (decision 12, BOUWPLAN v1.5). The user
// creates an app-specific password at appleid.apple.com; we store it encrypted.
import { parseIcs } from './ics.js';
import {
  CalendarAuthError,
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
        events.push(...parseIcs(data, { from, to, ...(credentials.username && { selfEmails: [credentials.username] }) }));
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

export { parseIcs };
