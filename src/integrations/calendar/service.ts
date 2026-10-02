// Everything the calendar needs, built once from env (BOUWPLAN.md, 11.8).
import type { Env } from '../../config/env.js';
import { AppleCalendarProvider } from './apple.js';
import { GoogleCalendarProvider } from './google.js';
import { MicrosoftCalendarProvider } from './microsoft.js';
import type { CalendarProvider, CalendarProviderName } from './types.js';

export interface CalendarService {
  google?: GoogleCalendarProvider | undefined;
  microsoft?: MicrosoftCalendarProvider | undefined;
  apple?: AppleCalendarProvider | undefined;
  /** ENCRYPTION_KEY: tokens and passwords are stored encrypted. */
  encryptionKey: string | undefined;
  /** Signs the personal connect link. */
  linkSecret: string | undefined;
  baseUrl: string | undefined;
}

export function providerFor(service: CalendarService, name: CalendarProviderName): CalendarProvider | undefined {
  return service[name];
}

/** Undefined when the calendar cannot work at all (no encryption key, link secret or base URL). */
export function buildCalendarService(env: Env): CalendarService | undefined {
  if (!env.ENCRYPTION_KEY || !env.ACTION_LINK_SECRET || !env.APP_BASE_URL) return undefined;
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI
      ? new GoogleCalendarProvider({
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          redirectUri: env.GOOGLE_REDIRECT_URI,
        })
      : undefined;
  const microsoft = new MicrosoftCalendarProvider({
    clientId: env.MICROSOFT_CLIENT_ID,
    clientSecret: env.MICROSOFT_CLIENT_SECRET,
    redirectUri: env.MICROSOFT_REDIRECT_URI,
  });
  return {
    google,
    microsoft: microsoft.isConfigured() ? microsoft : undefined,
    apple: new AppleCalendarProvider(),
    encryptionKey: env.ENCRYPTION_KEY,
    linkSecret: env.ACTION_LINK_SECRET,
    baseUrl: env.APP_BASE_URL,
  };
}
