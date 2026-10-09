import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { calendarConnections, events, tasks, users, userSettings, userTools, webSessions } from '../src/db/schema/index.js';
import { saveConnection } from '../src/integrations/calendar/store.js';
import { createSession } from '../src/web/auth/sessions.js';
import { fakeCalendar } from './helpers/calendar.js';
import { startServer } from './helpers/server.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

const BASE = 'https://app.hyper-focus.invalid';

describe.skipIf(!adminUrl)('dashboard: Instellingen (integration)', () => {
  const t = useTestDatabase();
  const db = () => t.connection.db;
  const clock = new Date('2026-10-07T07:00:00Z');
  const calendar = fakeCalendar();
  let cookie = '';

  beforeAll(async () => {
    cookie = `hf_session=${(await createSession(db(), t.userId, clock)).token}`;
  });

  async function call<T = unknown>(method: string, path: string, body?: unknown) {
    const s = await startServer(createApp({ dashboard: { db: db(), dashboardBaseUrl: BASE, calendar: calendar.service, now: () => clock } }));
    try {
      const res = await fetch(`${s.baseUrl}${path}`, {
        method,
        headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await res.text();
      return { status: res.status, headers: res.headers, body: (text ? JSON.parse(text) : undefined) as T };
    } finally {
      await s.close();
    }
  }
  type Settings = {
    profile: { name: string; timezone: string };
    rhythm: { pref: string | null; start: string | null; prefStart: string; minutes: number };
    workWeek: { days: number[]; start: string; end: string; reviewDay: number };
    day: { morningTime: string; middayEnabled: boolean; wrapupTime: string };
    quiet: { start: string; end: string };
    rewardsEnabled: boolean;
    calendar: { available: boolean; connections: Array<{ provider: string }> };
    tools: Array<{ workType: string; current: { label: string; url: string } | null; options: Array<{ key: string }> }>;
  };
  const settings = async () => (await call<Settings>('GET', '/api/settings')).body;

  it('shows the settings with their defaults', async () => {
    const s = await settings();
    expect(s.profile).toMatchObject({ name: 'Sam', timezone: 'Europe/Amsterdam' });
    expect(s.workWeek).toEqual({ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', reviewDay: 5 });
    expect(s.day).toEqual({ morningTime: '08:30', middayEnabled: true, wrapupTime: '16:00' });
    expect(s.quiet).toEqual({ start: '21:00', end: '08:00' });
    expect(s.rhythm).toMatchObject({ pref: null, start: null, prefStart: '10:30', minutes: 90 });
    expect(s.calendar).toMatchObject({ available: true, connections: [] });
    expect(s.tools.map((x) => x.workType)).toEqual(['invoicing', 'email', 'calendar', 'content', 'website', 'docs']);
  });

  it('changes the work week, day times, quiet hours, rewards and time zone', async () => {
    const patch = { workDays: [5, 1, 2, 3, 4, 1], workStart: '08:00', workEnd: '16:00', morningTime: '07:45', middayEnabled: false, quietStart: '20:00', rewardsEnabled: false, timezone: 'Asia/Makassar' };
    expect((await call('PATCH', '/api/settings', patch)).status).toBe(200);
    const s = await settings();
    expect(s.workWeek).toEqual({ days: [1, 2, 3, 4, 5], start: '08:00', end: '16:00', reviewDay: 5 });
    expect(s.day).toMatchObject({ morningTime: '07:45', middayEnabled: false });
    expect(s.quiet.start).toBe('20:00');
    expect(s.rewardsEnabled).toBe(false);
    expect(s.profile.timezone).toBe('Asia/Makassar');
    const names = (await db().select({ name: events.name }).from(events).where(eq(events.userId, t.userId))).map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(['rewards_toggled', 'work_week_set']));

    expect((await call('PATCH', '/api/settings', { workDays: [1, 2, 3, 4] })).status).toBe(200);
    expect((await settings()).workWeek.reviewDay).toBe(4);
    expect((await call('PATCH', '/api/settings', { workEnd: '07:00' })).status).toBe(400);
    expect((await call('PATCH', '/api/settings', { workDays: [] })).status).toBe(400);
    expect((await call('PATCH', '/api/settings', { timezone: 'Mars/Olympus' })).status).toBe(400);
    expect((await call('PATCH', '/api/settings', { morningTime: '7:45' })).status).toBe(400);
    await call('PATCH', '/api/settings', { timezone: 'Europe/Amsterdam' });
  });

  it('sets the rhythm: a preference, an own start and the length', async () => {
    expect((await call('POST', '/api/settings/rhythm', { pref: 'afternoon' })).status).toBe(200);
    expect((await settings()).rhythm).toMatchObject({ pref: 'afternoon', start: '13:30' });
    await call('POST', '/api/settings/rhythm', { start: '14:15', minutes: 60 });
    expect((await settings()).rhythm).toMatchObject({ pref: 'afternoon', start: '14:15', minutes: 60 });
    await call('POST', '/api/settings/rhythm', { start: null });
    expect((await settings()).rhythm.start).toBe('13:30');
    expect((await call('POST', '/api/settings/rhythm', { minutes: 75 })).status).toBe(400);
  });

  it('sets and removes a tool, and refuses a link that is not https', async () => {
    expect((await call('PUT', '/api/settings/tools/invoicing', { toolKey: 'moneybird' })).body).toEqual({ label: 'Moneybird', url: 'https://moneybird.com/login' });
    expect((await call('PUT', '/api/settings/tools/website', { url: 'https://mijnsite.invalid/wp-admin' })).status).toBe(200);
    expect((await call('PUT', '/api/settings/tools/website', { url: 'http://mijnsite.invalid' })).status).toBe(400);
    expect((await call('PUT', '/api/settings/tools/email', { toolKey: 'moneybird' })).status).toBe(400);
    expect((await call('PUT', '/api/settings/tools/kantoor', { toolKey: 'moneybird' })).status).toBe(404);
    const s = await settings();
    expect(s.tools.find((x) => x.workType === 'invoicing')?.current).toMatchObject({ label: 'Moneybird' });
    expect((await call('DELETE', '/api/settings/tools/invoicing')).status).toBe(200);
    expect((await db().select().from(userTools).where(eq(userTools.userId, t.userId))).map((x) => x.workType)).toEqual(['website']);
  });

  it('gives a personal calendar link, and disconnects with revoking access', async () => {
    const link = await call<{ url: string }>('POST', '/api/settings/calendar/connect', {});
    expect(link.body.url).toMatch(/^https:\/\/hyper-focus\.invalid\/agenda\/koppel\/.+/);
    await saveConnection(db(), t.userId, 'google', { accessToken: 'a', refreshToken: 'r', expiresAt: new Date('2027-01-01') }, calendar.service.encryptionKey);
    expect((await settings()).calendar.connections).toMatchObject([{ provider: 'google' }]);
    expect((await call('POST', '/api/settings/calendar/disconnect', {})).body).toEqual({ ok: true, removed: ['google'] });
    expect(calendar.provider.revoke).toHaveBeenCalledTimes(1);
    expect(await db().select().from(calendarConnections).where(eq(calendarConnections.userId, t.userId))).toEqual([]);
  });

  it('exports everything as a JSON download, without tokens or session hashes', async () => {
    await saveConnection(db(), t.userId, 'google', { accessToken: 'geheim-a', refreshToken: 'geheim-r', expiresAt: new Date('2027-01-01') }, calendar.service.encryptionKey);
    const res = await call<Record<string, unknown[]> & { user: { name: string } }>('GET', '/api/export');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="hyperfocus-gegevens-2026-10-07.json"');
    expect(res.body.user.name).toBe('Sam');
    expect(res.body.tasks!.length).toBeGreaterThan(0);
    expect(res.body.calendar_connections).toHaveLength(1);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/accessTokenEnc|refreshTokenEnc|tokenHash|geheim-/);
    expect(res.body).not.toHaveProperty('web_sessions');
  });

  it('deletes everything only after typing the word, revokes the calendar and logs out', async () => {
    expect((await call('POST', '/api/account/delete', { confirm: 'ja' })).status).toBe(400);
    expect((await db().select().from(users).where(eq(users.id, t.userId)))).toHaveLength(1);

    calendar.provider.revoke.mockClear();
    const res = await call('POST', '/api/account/delete', { confirm: 'Verwijder' });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/^hf_session=; .*Max-Age=0|^hf_session=;.*Expires=Thu, 01 Jan 1970/);
    expect(calendar.provider.revoke).toHaveBeenCalledTimes(1);
    for (const table of [users, userSettings, tasks, webSessions, events]) {
      const owner = 'userId' in table ? table.userId : users.id;
      expect(await db().select().from(table).where(eq(owner, t.userId))).toEqual([]);
    }
    expect((await call('GET', '/api/settings')).status).toBe(401);
  });
});
