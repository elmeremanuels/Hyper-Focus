// The personal connect pages (BOUWPLAN.md, 11.8): /agenda/koppel/{token} offers Google,
// Outlook and Apple. OAuth callbacks verify the same signed token as `state`.
import express, { Router, type Response } from 'express';
import { escapeHtml, page } from '../../channels/actions/page.js';
import type { Database } from '../../db/client.js';
import { users } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';
import type { CalendarService } from './service.js';
import { verifyConnectToken } from './state.js';
import { saveConnection } from './store.js';
import { syncUserCalendars } from './sync.js';
import { CalendarAuthError, type CalendarProviderName } from './types.js';

export interface CalendarRouteConfig {
  db: Database;
  service: CalendarService;
  /** Tells the user in Telegram (or by mail) that the calendar is connected. */
  notify?: (userId: number, text: string) => Promise<void>;
  now?: () => Date;
}

export const CONNECT_TEXTS = {
  invalid: 'Deze koppellink is verlopen of klopt niet. Stuur "koppel agenda" voor een nieuwe.',
  choose: 'Agenda koppelen',
  intro: 'Kies je agenda. Hyper&Focus leest alleen de tijden en titels van je afspraken van vandaag en morgen, en schrijft nooit iets in je agenda.',
  done: 'Je agenda is gekoppeld. Je kunt dit venster sluiten.',
  failed: 'Koppelen lukte niet. Probeer het opnieuw met een nieuwe link.',
  appleBadLogin: 'Apple accepteerde deze gegevens niet. Controleer je Apple ID en gebruik een app-specifiek wachtwoord.',
  notify: 'Je agenda is gekoppeld. Ik plan je dag vanaf nu rond je afspraken.',
} as const;

const NAMES: Record<CalendarProviderName, string> = { google: 'Google Agenda', microsoft: 'Outlook', apple: 'Apple iCloud-agenda' };

export function createCalendarRouter(config: CalendarRouteConfig): Router {
  const router = Router();
  const now = config.now ?? (() => new Date());
  const { service } = config;
  const userFor = (token: string | undefined) => (token && service.linkSecret ? verifyConnectToken(token, service.linkSecret, now()) : undefined);

  router.get('/agenda/koppel/:token', (req, res) => {
    if (userFor(req.params.token) === undefined) return send(res, 404, CONNECT_TEXTS.invalid);
    const base = `/agenda/koppel/${encodeURIComponent(req.params.token)}`;
    const links = (['google', 'microsoft', 'apple'] as const)
      .filter((name) => service[name])
      .map((name) => `<p><a class="button" href="${base}/${name}">${escapeHtml(NAMES[name])}</a></p>`)
      .join('\n');
    res.status(200).type('html').send(page(CONNECT_TEXTS.choose, `<p>${escapeHtml(CONNECT_TEXTS.intro)}</p>\n${links}`));
  });

  router.get('/agenda/koppel/:token/google', (req, res) => {
    if (userFor(req.params.token) === undefined || !service.google) return send(res, 404, CONNECT_TEXTS.invalid);
    res.redirect(service.google.oauth.getAuthUrl(req.params.token));
  });

  router.get('/agenda/koppel/:token/microsoft', (req, res) => {
    if (userFor(req.params.token) === undefined || !service.microsoft) return send(res, 404, CONNECT_TEXTS.invalid);
    res.redirect(service.microsoft.getAuthUrl(req.params.token));
  });

  router.get('/auth/google/callback', async (req, res, next) => {
    try {
      const userId = userFor(String(req.query.state ?? ''));
      if (userId === undefined || !service.google || typeof req.query.code !== 'string') return send(res, 400, CONNECT_TEXTS.invalid);
      const tokens = await service.google.oauth.exchangeCode(req.query.code);
      await connected(userId, 'google', { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiryDate });
      send(res, 200, CONNECT_TEXTS.done);
    } catch (error) {
      next(error);
    }
  });

  router.get('/auth/microsoft/callback', async (req, res, next) => {
    try {
      const userId = userFor(String(req.query.state ?? ''));
      if (userId === undefined || !service.microsoft || typeof req.query.code !== 'string') return send(res, 400, CONNECT_TEXTS.invalid);
      await connected(userId, 'microsoft', await service.microsoft.exchangeCode(req.query.code));
      send(res, 200, CONNECT_TEXTS.done);
    } catch (error) {
      next(error);
    }
  });

  router.get('/agenda/koppel/:token/apple', (req, res) => {
    if (userFor(req.params.token) === undefined || !service.apple) return send(res, 404, CONNECT_TEXTS.invalid);
    res.status(200).type('html').send(page('Apple-agenda koppelen', appleForm(req.params.token)));
  });

  router.post('/agenda/koppel/:token/apple', express.urlencoded({ extended: false, limit: '4kb' }), async (req, res, next) => {
    try {
      const userId = userFor(req.params.token);
      if (userId === undefined || !service.apple) return send(res, 404, CONNECT_TEXTS.invalid);
      const body = req.body as { username?: string; password?: string };
      const username = (body.username ?? '').trim();
      const password = (body.password ?? '').replace(/\s/g, '');
      if (!username || !password) return void res.status(400).type('html').send(page('Apple-agenda koppelen', appleForm(req.params.token, CONNECT_TEXTS.appleBadLogin)));
      let calendars: string[];
      try {
        calendars = await service.apple.discover(username, password);
      } catch (error) {
        if (error instanceof CalendarAuthError) {
          return void res.status(401).type('html').send(page('Apple-agenda koppelen', appleForm(req.params.token, CONNECT_TEXTS.appleBadLogin)));
        }
        throw error;
      }
      await connected(userId, 'apple', { username, password, calendars });
      send(res, 200, CONNECT_TEXTS.done);
    } catch (error) {
      next(error);
    }
  });

  async function connected(userId: number, provider: CalendarProviderName, credentials: Parameters<typeof saveConnection>[3]) {
    await saveConnection(config.db, userId, provider, credentials, service.encryptionKey);
    const [user] = await config.db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId));
    await syncUserCalendars(config.db, service, userId, user?.timezone ?? 'Europe/Amsterdam', now());
    await config.notify?.(userId, CONNECT_TEXTS.notify).catch((error: unknown) => console.error('Notify failed:', error));
  }

  return router;
}

function appleForm(token: string, error?: string): string {
  return `${error ? `<p><strong>${escapeHtml(error)}</strong></p>` : ''}
<p>Maak eerst een app-specifiek wachtwoord op <a href="https://account.apple.com" rel="noreferrer">account.apple.com</a> (Inloggen en beveiliging → App-specifieke wachtwoorden). Je gewone wachtwoord werkt niet en hoeven we niet.</p>
<form method="post" action="/agenda/koppel/${encodeURIComponent(token)}/apple">
<p><label>Apple ID (e-mailadres)<br><input name="username" type="email" autocomplete="username" required></label></p>
<p><label>App-specifiek wachtwoord<br><input name="password" type="password" autocomplete="off" required></label></p>
<p><button type="submit">Koppelen</button></p>
</form>
<p>Het wachtwoord wordt versleuteld bewaard. Ontkoppelen kan altijd met "ontkoppel agenda".</p>`;
}

function send(res: Response, status: number, text: string) {
  res.status(status).type('html').send(page(status === 200 ? 'Klaar' : 'Agenda koppelen', `<p>${escapeHtml(text)}</p>`));
}
