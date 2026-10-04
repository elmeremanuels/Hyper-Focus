// The personal connect page (BOUWPLAN.md, 11.8): /agenda/koppel/{token} asks for the secret
// ICS link of any calendar. Direct connections (Google, Outlook, Apple CalDAV) appear only
// when set up in .env. OAuth callbacks verify the same signed token as `state`.
import express, { Router, type Response } from 'express';
import { escapeHtml, page } from '../../channels/actions/page.js';
import type { Database } from '../../db/client.js';
import { users } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';
import type { CalendarService } from './service.js';
import { verifyConnectToken } from './state.js';
import { saveConnection } from './store.js';
import { syncUserCalendars } from './sync.js';
import { icsLinkProblem, normalizeIcsUrl } from './ics.js';
import { CALENDAR_GUIDES } from '../../texts/agenda.nl.js';
import { CalendarAuthError, type CalendarProviderName } from './types.js';

export interface CalendarRouteConfig {
  db: Database;
  service: CalendarService;
  /** Tells the user in Telegram (or by mail) that the calendar is connected. */
  notify?: (userId: number, text: string) => Promise<void>;
  now?: () => Date;
  /** DNS lookup for the ICS link check; tests replace it. */
  resolveHost?: (host: string) => Promise<string[]>;
}

export const CONNECT_TEXTS = {
  invalid: 'Deze koppellink is verlopen of klopt niet. Stuur "koppel agenda" voor een nieuwe.',
  choose: 'Agenda koppelen',
  intro: 'Plak de geheime ICS-link van je agenda. Hyper&Focus bewaart alleen de tijden en titels van je afspraken van vandaag en morgen, en schrijft nooit in je agenda.',
  icsInvalid: 'Dit is geen geldige agendalink. Gebruik de link die begint met https:// of webcal://.',
  googlePublic: 'Dit is het openbare adres van Google. Kopieer het Geheim adres in iCal-indeling; daar staat /private- in.',
  outlookHtml: 'Dit is de HTML-link van Outlook. Kopieer de ICS-link; die eindigt op .ics.',
  icsUnreachable: 'Deze link gaf geen agenda terug. Controleer of je de geheime ICS-link hebt gekopieerd.',
  direct: 'Of koppel direct:',
  done: 'Je agenda is gekoppeld. Je kunt dit venster sluiten.',
  failed: 'Koppelen lukte niet. Probeer het opnieuw met een nieuwe link.',
  appleBadLogin: 'Apple accepteerde deze gegevens niet. Controleer je Apple ID en gebruik een app-specifiek wachtwoord.',
  notify: 'Je agenda is gekoppeld. Ik plan je dag vanaf nu rond je afspraken.',
} as const;

const NAMES: Record<CalendarProviderName, string> = {
  ics: 'ICS-link',
  google: 'Google Agenda',
  microsoft: 'Outlook',
  apple: 'Apple iCloud-agenda',
};

export function createCalendarRouter(config: CalendarRouteConfig): Router {
  const router = Router();
  const now = config.now ?? (() => new Date());
  const { service } = config;
  const userFor = (token: string | undefined) => (token && service.linkSecret ? verifyConnectToken(token, service.linkSecret, now()) : undefined);

  router.get('/agenda/koppel/:token', (req, res) => {
    if (userFor(req.params.token) === undefined) return send(res, 404, CONNECT_TEXTS.invalid);
    res.status(200).type('html').send(page(CONNECT_TEXTS.choose, connectPage(req.params.token)));
  });

  router.post('/agenda/koppel/:token/ics', express.urlencoded({ extended: false, limit: '8kb' }), async (req, res, next) => {
    try {
      const userId = userFor(req.params.token);
      if (userId === undefined || !service.ics) return send(res, 404, CONNECT_TEXTS.invalid);
      const formError = (status: number, text: string) =>
        void res.status(status).type('html').send(page(CONNECT_TEXTS.choose, connectPage(req.params.token, text)));

      const url = await normalizeIcsUrl(String((req.body as { url?: unknown }).url ?? ''), config.resolveHost);
      if (!url) return formError(400, CONNECT_TEXTS.icsInvalid);
      const problem = icsLinkProblem(url);
      if (problem) return formError(400, CONNECT_TEXTS[problem]);
      const [user] = await config.db.select({ email: users.email, timezone: users.timezone }).from(users).where(eq(users.id, userId));
      const credentials = { url, ...(user?.email && { username: user.email }) };
      try {
        // A test read: today and tomorrow.
        const start = now();
        await service.ics.listEvents({ ...credentials, ...(user?.timezone && { timezone: user.timezone }) }, start, new Date(start.getTime() + 2 * 86_400_000));
      } catch {
        return formError(422, CONNECT_TEXTS.icsUnreachable);
      }
      await connected(userId, 'ics', credentials);
      send(res, 200, CONNECT_TEXTS.done);
    } catch (error) {
      next(error);
    }
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

  function connectPage(token: string, error?: string): string {
    const base = `/agenda/koppel/${encodeURIComponent(token)}`;
    const direct = (['google', 'microsoft', 'apple'] as const)
      .filter((name) => service[name])
      .map((name) => `<a class="button" href="${base}/${name}">${escapeHtml(NAMES[name])}</a>`)
      .join(' ');
    return `${error ? `<p><strong>${escapeHtml(error)}</strong></p>` : ''}
<p>${escapeHtml(CONNECT_TEXTS.intro)}</p>
${service.ics ? `<form method="post" action="${base}/ics">
<p><label>ICS-link<br><input name="url" type="url" inputmode="url" autocomplete="off" required style="width:100%" placeholder="https://… of webcal://…"></label></p>
<p><button type="submit">Koppelen</button></p>
</form>
${CALENDAR_GUIDES.map((g) => `<details><summary>${escapeHtml(g.title)}</summary>${g.html}</details>`).join('\n')}
<p>Hyper&amp;Focus bewaart de link versleuteld. Ontkoppelen kan altijd met "ontkoppel agenda".</p>` : ''}
${direct ? `<p>${escapeHtml(CONNECT_TEXTS.direct)}</p><p>${direct}</p>` : ''}`;
  }

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
