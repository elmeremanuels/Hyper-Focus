import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createAssistantRouter } from '../src/conversation/assistant.js';
import { loginTokens, users, webSessions } from '../src/db/schema/index.js';
import { scriptedClaude } from './helpers/claude.js';
import { startServer } from './helpers/server.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

const BASE = 'https://app.hyper-focus.invalid';

describe.skipIf(!adminUrl)('dashboard login (integration)', () => {
  const t = useTestDatabase();
  const db = () => t.connection.db;
  let clock = new Date('2026-10-07T08:00:00Z');
  const sendLoginMail = vi.fn(async (_userId: number, _url: string) => undefined);
  let firstLink = '';

  async function server() {
    return startServer(
      createApp({
        auth: {
          db: db(),
          dashboardBaseUrl: BASE,
          now: () => clock,
          sendLoginMail,
          findUserByEmail: async (email) => {
            const [row] = await db().select({ id: users.id }).from(users).where(eq(users.email, email));
            return row;
          },
        },
        dashboardApi: { db: db(), botToken: undefined, now: () => clock },
      }),
    );
  }
  const email = async () => (await db().select({ email: users.email }).from(users).where(eq(users.id, t.userId)))[0]!.email!;
  const tokenFrom = (url: string) => new URL(url).searchParams.get('t')!;
  const post = (base: string, path: string, body: Record<string, string>, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body) });

  it('mails a one-time link for a known address, and answers the same for an unknown one', async () => {
    const s = await server();
    try {
      const unknown = await post(s.baseUrl, '/auth/magic-link', { email: 'niemand@voorbeeld.invalid' });
      expect([unknown.status, unknown.headers.get('location')]).toEqual([303, '/login?sent=1']);
      expect(sendLoginMail).not.toHaveBeenCalled();

      const known = await post(s.baseUrl, '/auth/magic-link', { email: (await email()).toUpperCase() });
      expect([known.status, known.headers.get('location')]).toEqual([303, '/login?sent=1']);
      expect(sendLoginMail).toHaveBeenCalledTimes(1);
      const [userId, url] = sendLoginMail.mock.calls[0]!;
      firstLink = url;
      expect(userId).toBe(t.userId);
      expect(url).toMatch(/^https:\/\/app\.hyper-focus\.invalid\/auth\/login\?t=[\w-]{40,}$/);
      // Only the hash is stored.
      const [row] = await db().select().from(loginTokens);
      expect(row?.tokenHash).toHaveLength(64);
      expect(row?.tokenHash).not.toBe(tokenFrom(url));
    } finally {
      await s.close();
    }
  });

  it('logs in only after the tap on the confirm page, once, and sets a safe cookie', async () => {
    const s = await server();
    try {
      const token = tokenFrom(firstLink);
      // Opening the link (or a link preview) does not use it up.
      for (let i = 0; i < 2; i++) {
        const page = await fetch(`${s.baseUrl}/auth/login?t=${token}`);
        expect(page.status).toBe(200);
        expect(await page.text()).toContain('Tik op de knop om in te loggen.');
      }
      const login = await post(s.baseUrl, '/auth/login', { t: token });
      // A page with the cookie, then on to the app: in-app browsers drop cookies on redirects.
      expect(login.status).toBe(200);
      expect(await login.text()).toContain('<meta http-equiv="refresh" content="1;url=/?login=1">');
      const cookie = login.headers.get('set-cookie') ?? '';
      expect(cookie).toMatch(/^hf_session=[\w-]{40,}; Path=\/; HttpOnly; SameSite=Lax; Expires=.+; Secure$/);

      const me = await fetch(`${s.baseUrl}/api/me`, { headers: { cookie: cookie.split(';')[0]! } });
      expect(await me.json()).toEqual({ name: 'Sam', timezone: 'Europe/Amsterdam' });

      // The login page sends a logged-in user on; after a failed cookie it says what to do.
      const again = await fetch(`${s.baseUrl}/login`, { redirect: 'manual', headers: { cookie: cookie.split(';')[0]! } });
      expect([again.status, again.headers.get('location')]).toEqual([303, '/']);
      expect(await (await fetch(`${s.baseUrl}/login?failed=1`)).text()).toContain('Open de link in Safari of Chrome');

      expect((await post(s.baseUrl, '/auth/login', { t: token })).status).toBe(410);
      expect((await fetch(`${s.baseUrl}/auth/login?t=${token}`)).status).toBe(410);
      expect((await fetch(`${s.baseUrl}/api/me`)).status).toBe(401);
    } finally {
      await s.close();
    }
  });

  it('lets a link expire after 15 minutes and limits links to 3 per quarter', async () => {
    const s = await server();
    try {
      clock = new Date('2026-10-07T09:00:00Z');
      sendLoginMail.mockClear();
      for (let i = 0; i < 4; i++) await post(s.baseUrl, '/auth/magic-link', { email: await email() });
      expect(sendLoginMail).toHaveBeenCalledTimes(3);
      const token = tokenFrom(sendLoginMail.mock.calls[0]![1]);
      clock = new Date('2026-10-07T09:16:00Z');
      expect((await post(s.baseUrl, '/auth/login', { t: token })).status).toBe(410);
    } finally {
      await s.close();
    }
  });

  it('extends a session with use and ends it at logout', async () => {
    const s = await server();
    try {
      clock = new Date('2026-10-07T10:00:00Z');
      sendLoginMail.mockClear();
      await post(s.baseUrl, '/auth/magic-link', { email: await email() });
      const login = await post(s.baseUrl, '/auth/login', { t: tokenFrom(sendLoginMail.mock.calls[0]![1]) });
      const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;

      clock = new Date('2026-10-07T12:00:00Z');
      const later = await fetch(`${s.baseUrl}/api/me`, { headers: { cookie } });
      expect(later.status).toBe(200);
      const [session] = (await db().select().from(webSessions)).slice(-1);
      expect(session?.lastSeenAt).toEqual(clock);

      const out = await fetch(`${s.baseUrl}/auth/logout`, { method: 'POST', headers: { cookie, accept: 'application/json' } });
      expect(out.headers.get('set-cookie')).toContain('hf_session=;');
      expect((await fetch(`${s.baseUrl}/api/me`, { headers: { cookie } })).status).toBe(401);
    } finally {
      await s.close();
    }
  });

  it('gives a login link in Telegram with "dashboard" and the /help button', async () => {
    const router = createAssistantRouter({ db: db(), claude: scriptedClaude([]), now: () => new Date('2026-10-08T08:00:00Z'), dashboardBaseUrl: BASE });
    const [reply] = await router({ kind: 'text', userId: t.userId, text: 'dashboard' });
    expect(reply?.text).toBe('Je dashboard staat klaar. De link werkt 15 minuten en één keer.');
    expect(reply?.buttons?.[0]).toMatchObject({ title: 'Open dashboard', url: expect.stringMatching(/^https:\/\/app\.hyper-focus\.invalid\/auth\/login\?t=/) });
    const [tapped] = await router({ kind: 'button', userId: t.userId, buttonId: 'db:open', title: 'Open dashboard' });
    expect(tapped?.buttons?.[0]?.url).toContain('/auth/login?t=');
    const [help] = await router({ kind: 'text', userId: t.userId, text: 'help' });
    expect(help?.buttons?.map((b) => b.id)).toContain('db:open');

    const off = createAssistantRouter({ db: db(), claude: scriptedClaude([]) });
    expect((await off({ kind: 'text', userId: t.userId, text: 'dashboard' }))[0]?.text).toBe('Het dashboard staat nog niet aan.');
  });

  it('removes links and sessions with the user', async () => {
    await db().delete(users).where(eq(users.id, t.userId));
    expect(await db().select().from(loginTokens)).toHaveLength(0);
    expect(await db().select().from(webSessions)).toHaveLength(0);
  });
});
