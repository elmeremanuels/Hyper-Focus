// One interface for every calendar (BOUWPLAN.md, 11.8): Google, Outlook and Apple.

export type CalendarProviderName = 'google' | 'microsoft' | 'apple';

/** Only the fields we keep (BOUWPLAN.md, 14): no attendees, descriptions or locations. */
export interface ProviderEvent {
  externalId: string;
  startsAt: Date;
  endsAt: Date;
  title: string;
  /** All-day events: start and end are midnight UTC of the local dates (end exclusive). */
  isAllDay: boolean;
  /** False for events marked free/available. */
  isBusy: boolean;
}

/** Decrypted credentials of one connection. */
export interface Credentials {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  /** Apple: Apple ID and app-specific password. */
  username?: string;
  password?: string;
  /** Apple: calendar collection URLs. Google: calendar ids. */
  calendars?: string[];
}

export interface ListResult {
  events: ProviderEvent[];
  /** New tokens after a refresh, to store. */
  refreshed?: Credentials;
}

export interface CalendarProvider {
  readonly name: CalendarProviderName;
  /** Events overlapping [from, to); declined and cancelled events are left out. */
  listEvents(credentials: Credentials, from: Date, to: Date): Promise<ListResult>;
  /** Revokes access at the provider where it can. */
  revoke(credentials: Credentials): Promise<void>;
}

export class CalendarAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarAuthError';
  }
}

export type FetchLike = typeof fetch;

/** Midnight UTC of a YYYY-MM-DD date. */
export function dateToUtc(date: string): Date {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`);
}

/** Tokens count as expired one minute early. */
export function isExpired(expiresAt: Date | null | undefined, now = new Date()): boolean {
  return !expiresAt || expiresAt.getTime() - 60_000 <= now.getTime();
}
