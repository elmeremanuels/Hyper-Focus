// Logging in to the dashboard (step 2a.1): a magic link by mail, or a one-time link from
// Telegram. A link opens a confirm page first, so mail scanners and link previews cannot use
// it up. The auth middleware follows the pattern of Publicato server/middleware/auth.ts.
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import type { Database } from '../../db/client.js';
import { LOGIN_TEXTS } from '../../texts/dashboard.nl.js';
import { authPage, escapeHtml } from './pages.js';
import {
  clearedCookie,
  consumeLoginToken,
  createLoginToken,
  createSession,
  deleteSession,
  isLoginTokenValid,
  readCookie,
  SESSION_COOKIE,
  sessionCookie,
  sessionUser,
} from './sessions.js';

export interface AuthConfig {
  db: Database;
  /** https://app.hyper-focus.pro */
  dashboardBaseUrl: string;
  findUserByEmail: (email: string) => Promise<{ id: number } | undefined>;
  sendLoginMail: (userId: number, url: string) => Promise<void>;
  now?: () => Date;
}

export function loginUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, '')}/auth/login?t=${encodeURIComponent(token)}`;
}

const secure = (baseUrl: string) => baseUrl.startsWith('https://');

/** 401 without a valid session; otherwise the user id is on res.locals.userId. */
export function requireSession(config: Pick<AuthConfig, 'db' | 'dashboardBaseUrl' | 'now'>) {
  const now = config.now ?? (() => new Date());
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = readCookie(req.get('cookie'), SESSION_COOKIE);
      const session = token ? await sessionUser(config.db, token, now()) : undefined;
      if (!token || !session) return void res.status(401).json({ error: LOGIN_TEXTS.notLoggedIn });
      if (session.refreshed) res.append('Set-Cookie', sessionCookie(token, session.expiresAt, secure(config.dashboardBaseUrl)));
      res.locals.userId = session.userId;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function createAuthRouter(config: AuthConfig): Router {
  const router = Router();
  const now = config.now ?? (() => new Date());
  const form = express.urlencoded({ extended: false, limit: '4kb' });
  const json = express.json({ limit: '4kb' });
  const isSecure = secure(config.dashboardBaseUrl);

  router.get('/login', (req, res) => {
    const sent = req.query.sent === '1';
    res
      .type('html')
      .set('Cache-Control', 'no-store')
      .send(
        authPage(
          LOGIN_TEXTS.title,
          sent
            ? `<p>${escapeHtml(LOGIN_TEXTS.sent)}</p>`
            : `<p>${escapeHtml(LOGIN_TEXTS.intro)}</p>
<form method="post" action="/auth/magic-link">
<label for="email">${escapeHtml(LOGIN_TEXTS.email)}</label>
<input id="email" name="email" type="email" autocomplete="email" required>
<button type="submit">${escapeHtml(LOGIN_TEXTS.send)}</button>
</form>`,
        ),
      );
  });

  // Always the same answer, so the form does not reveal which addresses exist.
  router.post('/auth/magic-link', form, json, async (req, res, next) => {
    try {
      const email = String((req.body as { email?: unknown } | undefined)?.email ?? '').trim().toLowerCase();
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        const user = await config.findUserByEmail(email);
        const token = user ? await createLoginToken(config.db, user.id, 'email', now()) : undefined;
        if (user && token) await config.sendLoginMail(user.id, loginUrl(config.dashboardBaseUrl, token));
      }
      if (req.is('application/json')) return void res.json({ ok: true });
      res.redirect(303, '/login?sent=1');
    } catch (error) {
      next(error);
    }
  });

  // Step 1: a page with a button. Opening a link never logs in by itself.
  router.get('/auth/login', async (req, res, next) => {
    try {
      const token = typeof req.query.t === 'string' ? req.query.t : '';
      const valid = token ? await isLoginTokenValid(config.db, token, now()) : false;
      res.type('html').set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer');
      if (!valid) {
        return void res
          .status(410)
          .send(authPage(LOGIN_TEXTS.confirmTitle, `<p>${escapeHtml(LOGIN_TEXTS.invalid)}</p><a class="button" href="/login">${escapeHtml(LOGIN_TEXTS.newLink)}</a>`));
      }
      res.send(
        authPage(
          LOGIN_TEXTS.confirmTitle,
          `<p>${escapeHtml(LOGIN_TEXTS.confirm)}</p>
<form method="post" action="/auth/login">
<input type="hidden" name="t" value="${escapeHtml(token)}">
<button type="submit">${escapeHtml(LOGIN_TEXTS.confirmButton)}</button>
</form>`,
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  // Step 2: the tap uses the token once and starts a session.
  router.post('/auth/login', form, async (req, res, next) => {
    try {
      const token = String((req.body as { t?: unknown } | undefined)?.t ?? '');
      const userId = await consumeLoginToken(config.db, token, now());
      if (!userId) {
        return void res
          .status(410)
          .type('html')
          .send(authPage(LOGIN_TEXTS.confirmTitle, `<p>${escapeHtml(LOGIN_TEXTS.invalid)}</p><a class="button" href="/login">${escapeHtml(LOGIN_TEXTS.newLink)}</a>`));
      }
      const session = await createSession(config.db, userId, now());
      res.append('Set-Cookie', sessionCookie(session.token, session.expiresAt, isSecure));
      res.redirect(303, '/');
    } catch (error) {
      next(error);
    }
  });

  router.post('/auth/logout', async (req, res, next) => {
    try {
      const token = readCookie(req.get('cookie'), SESSION_COOKIE);
      if (token) await deleteSession(config.db, token);
      res.append('Set-Cookie', clearedCookie(isSecure));
      if (req.accepts(['html', 'json']) === 'json') return void res.json({ ok: true });
      res.redirect(303, '/login');
    } catch (error) {
      next(error);
    }
  });

  return router;
}
