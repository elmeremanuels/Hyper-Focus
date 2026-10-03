// A fake CalendarProvider with fixed appointments (BOUWPLAN.md, 15).
import { vi } from 'vitest';
import { IcsCalendarProvider } from '../../src/integrations/calendar/ics.js';
import type { CalendarService } from '../../src/integrations/calendar/service.js';
import type { CalendarProvider, Credentials, ProviderEvent } from '../../src/integrations/calendar/types.js';

export function fakeCalendar(events: ProviderEvent[] = []) {
  const state = { events, fail: false };
  const provider = {
    name: 'google' as const,
    listEvents: vi.fn(async (_credentials: Credentials, from: Date, to: Date) => {
      if (state.fail) throw new Error('Google 500');
      return { events: state.events.filter((e) => e.endsAt > from && e.startsAt < to) };
    }),
    revoke: vi.fn(async () => undefined),
    oauth: {
      getAuthUrl: (stateToken: string) => `https://accounts.invalid/auth?state=${stateToken}`,
      exchangeCode: vi.fn(async () => ({ accessToken: 'access-1', refreshToken: 'refresh-1', scope: [], expiryDate: new Date('2027-01-01T00:00:00Z') })),
    },
  };
  const apple = {
    name: 'apple' as const,
    listEvents: vi.fn(async () => ({ events: [] })),
    revoke: vi.fn(async () => undefined),
    discover: vi.fn(async (_u: string, password: string) => {
      if (password !== 'abcd-efgh-ijkl-mnop') {
        const { CalendarAuthError } = await import('../../src/integrations/calendar/types.js');
        throw new CalendarAuthError('CalDAV 401');
      }
      return ['https://p01-caldav.invalid/123/calendars/home/'];
    }),
  };
  const feeds = new Map<string, string>();
  const icsFetch = vi.fn(async (url: string | URL | Request) => {
    const feed = feeds.get(String(url));
    return feed ? new Response(feed) : new Response('<html>niet gevonden</html>', { status: 200 });
  });
  const service = {
    ics: new IcsCalendarProvider(icsFetch as typeof fetch),
    google: provider,
    apple,
    encryptionKey: 'e'.repeat(40),
    linkSecret: 'l'.repeat(40),
    baseUrl: 'https://hyper-focus.invalid',
  } as unknown as CalendarService;
  return { service, provider: provider as CalendarProvider & typeof provider, apple, state, feeds, icsFetch };
}

export const appointment = (id: string, start: string, end: string, title: string, overrides: Partial<ProviderEvent> = {}): ProviderEvent => ({
  externalId: id,
  startsAt: new Date(start),
  endsAt: new Date(end),
  title,
  isAllDay: false,
  isBusy: true,
  ...overrides,
});
