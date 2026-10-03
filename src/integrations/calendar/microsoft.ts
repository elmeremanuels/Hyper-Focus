// Outlook and Microsoft 365 via Microsoft Graph, read-only (Calendars.Read).
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

export const MICROSOFT_SCOPES = ['offline_access', 'Calendars.Read'] as const;
const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';

export interface MicrosoftOAuthConfig {
  clientId: string | undefined;
  clientSecret: string | undefined;
  redirectUri: string | undefined;
}

interface GraphEvent {
  id: string;
  subject?: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  showAs?: string;
  responseStatus?: { response?: string };
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
}

export class MicrosoftCalendarProvider implements CalendarProvider {
  readonly name = 'microsoft' as const;

  constructor(
    private readonly config: MicrosoftOAuthConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.clientId && this.config.clientSecret && this.config.redirectUri);
  }

  getAuthUrl(state: string): string {
    const url = new URL(`${AUTHORITY}/authorize`);
    url.search = new URLSearchParams({
      client_id: this.config.clientId ?? '',
      response_type: 'code',
      redirect_uri: this.config.redirectUri ?? '',
      response_mode: 'query',
      scope: MICROSOFT_SCOPES.join(' '),
      state,
      prompt: 'select_account',
    }).toString();
    return url.toString();
  }

  async exchangeCode(code: string): Promise<Credentials> {
    return this.token({ grant_type: 'authorization_code', code, redirect_uri: this.config.redirectUri ?? '' });
  }

  private async token(params: Record<string, string>): Promise<Credentials> {
    const response = await this.fetchImpl(`${AUTHORITY}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId ?? '',
        client_secret: this.config.clientSecret ?? '',
        scope: MICROSOFT_SCOPES.join(' '),
        ...params,
      }).toString(),
    });
    const body = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
    if (!response.ok || !body.access_token) throw new CalendarAuthError(`Microsoft token: ${body.error ?? response.status}`);
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? params.refresh_token ?? null,
      expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000),
    };
  }

  async listEvents(credentials: Credentials, from: Date, to: Date): Promise<ListResult> {
    let accessToken = credentials.accessToken ?? null;
    let refreshed: Credentials | undefined;
    if (isExpired(credentials.expiresAt) || !accessToken) {
      if (!credentials.refreshToken) throw new CalendarAuthError('No Microsoft refresh token');
      refreshed = await this.token({ grant_type: 'refresh_token', refresh_token: credentials.refreshToken });
      accessToken = refreshed.accessToken ?? null;
    }

    const events: ProviderEvent[] = [];
    const first = new URL('https://graph.microsoft.com/v1.0/me/calendarView');
    first.search = new URLSearchParams({
      startDateTime: from.toISOString(),
      endDateTime: to.toISOString(),
      $select: 'id,subject,isAllDay,isCancelled,showAs,responseStatus,start,end',
      $top: '100',
    }).toString();
    let next: string | undefined = first.toString();
    while (next) {
      const response = await this.fetchImpl(next, {
        headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="UTC"' },
      });
      if (response.status === 401 || response.status === 403) throw new CalendarAuthError(`Microsoft ${response.status}`);
      if (!response.ok) throw new Error(`Microsoft Graph ${response.status}`);
      const page = (await response.json()) as { value?: GraphEvent[]; '@odata.nextLink'?: string };
      events.push(...(page.value ?? []).flatMap((item) => mapGraphEvent(item)));
      next = page['@odata.nextLink'];
    }
    return { events, ...(refreshed && { refreshed }) };
  }

  /** Graph has no revoke endpoint for these tokens; deleting them ends our access. */
  async revoke(): Promise<void> {}
}

export function mapGraphEvent(item: GraphEvent): ProviderEvent[] {
  if (item.isCancelled || item.responseStatus?.response === 'declined') return [];
  const isAllDay = Boolean(item.isAllDay);
  const parse = (value: string | undefined) =>
    isAllDay ? dateToUtc(value ?? '') : new Date(`${(value ?? '').replace(/(\.\d{3})\d*$/, '$1')}Z`);
  const start = parse(item.start?.dateTime);
  const end = parse(item.end?.dateTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  return [
    {
      externalId: item.id,
      startsAt: start,
      endsAt: end,
      title: item.subject?.trim() || '(zonder titel)',
      isAllDay,
      isBusy: item.showAs !== 'free' && item.showAs !== 'workingElsewhere',
    },
  ];
}
