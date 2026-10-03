// Google Calendar, read-only (BOUWPLAN.md, 11.8). OAuth comes from oauth.ts (harvested).
import { GoogleCalendarOAuth, type GoogleOAuthConfig } from './oauth.js';
import {
  CalendarAuthError,
  dateToUtc,
  isExpired,
  type CalendarProvider,
  type Credentials,
  type FetchLike,
  type ListResult,
  type ProviderEvent,
} from './types.js';

interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  transparency?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
}

// Attendees are requested only for our own response; names and addresses are never fetched.
const FIELDS = 'nextPageToken,items(id,status,summary,transparency,start,end,attendees(self,responseStatus))';

export class GoogleCalendarProvider implements CalendarProvider {
  readonly name = 'google' as const;
  readonly oauth: GoogleCalendarOAuth;

  constructor(
    config: GoogleOAuthConfig,
    private readonly fetchImpl: FetchLike = fetch,
    oauth?: GoogleCalendarOAuth,
  ) {
    this.oauth = oauth ?? new GoogleCalendarOAuth(config);
  }

  async listEvents(credentials: Credentials, from: Date, to: Date): Promise<ListResult> {
    let accessToken = credentials.accessToken ?? null;
    let refreshed: Credentials | undefined;
    if (isExpired(credentials.expiresAt) || !accessToken) {
      if (!credentials.refreshToken) throw new CalendarAuthError('No Google refresh token');
      const tokens = await this.oauth.refreshAccessToken(credentials.refreshToken);
      accessToken = tokens.accessToken;
      refreshed = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? credentials.refreshToken,
        expiresAt: tokens.expiryDate,
      };
    }
    if (!accessToken) throw new CalendarAuthError('No Google access token');

    const events: ProviderEvent[] = [];
    for (const calendarId of credentials.calendars?.length ? credentials.calendars : ['primary']) {
      let pageToken: string | undefined;
      do {
        const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
        url.search = new URLSearchParams({
          timeMin: from.toISOString(),
          timeMax: to.toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '250',
          fields: FIELDS,
          ...(pageToken && { pageToken }),
        }).toString();
        const response = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (response.status === 401 || response.status === 403) throw new CalendarAuthError(`Google ${response.status}`);
        if (!response.ok) throw new Error(`Google Calendar ${response.status}`);
        const page = (await response.json()) as { items?: GoogleEvent[]; nextPageToken?: string };
        events.push(...(page.items ?? []).flatMap((item) => mapGoogleEvent(item)));
        pageToken = page.nextPageToken;
      } while (pageToken);
    }
    return { events, ...(refreshed && { refreshed }) };
  }

  async revoke(credentials: Credentials): Promise<void> {
    const token = credentials.refreshToken ?? credentials.accessToken;
    if (token) await this.oauth.revokeToken(token);
  }
}

export function mapGoogleEvent(item: GoogleEvent): ProviderEvent[] {
  if (item.status === 'cancelled') return [];
  if (item.attendees?.some((a) => a.self && a.responseStatus === 'declined')) return [];
  const isAllDay = Boolean(item.start?.date);
  const start = isAllDay ? dateToUtc(item.start?.date ?? '') : new Date(item.start?.dateTime ?? '');
  const end = isAllDay ? dateToUtc(item.end?.date ?? item.start?.date ?? '') : new Date(item.end?.dateTime ?? '');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  return [
    {
      externalId: item.id,
      startsAt: start,
      endsAt: end,
      title: item.summary?.trim() || '(zonder titel)',
      isAllDay,
      isBusy: item.transparency !== 'transparent',
    },
  ];
}
