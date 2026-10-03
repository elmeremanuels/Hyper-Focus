import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { focusBlocks, focusWindows, tasks, userSettings } from '../src/db/schema/index.js';
import { runPlanner } from '../src/proactive/planner.js';
import { createSession } from '../src/web/auth/sessions.js';
import { startServer } from './helpers/server.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

// Amsterdam is UTC+2 in October: 07:00 UTC is 09:00 local.
const at = (day: string, time: string) => new Date(`${day}T${time}Z`);

describe.skipIf(!adminUrl)('dashboard: Vandaag (integration)', () => {
  const t = useTestDatabase();
  const db = () => t.connection.db;
  let clock = at('2026-10-07', '07:00:00');
  let cookie = '';

  beforeAll(async () => {
    await db().update(userSettings).set({ workDays: [1, 2, 3, 4, 5, 6, 7] }).where(eq(userSettings.userId, t.userId));
    await runPlanner(db(), at('2026-10-06', '22:05:00'));
    cookie = `hf_session=${(await createSession(db(), t.userId, clock)).token}`;
  });

  async function call<T = unknown>(method: string, path: string, body?: unknown, headers: Record<string, string> = { cookie }) {
    const s = await startServer(
      createApp({
        auth: { db: db(), dashboardBaseUrl: 'https://app.hyper-focus.invalid', now: () => clock, sendLoginMail: async () => undefined, findUserByEmail: async () => undefined },
        dashboard: { db: db(), dashboardBaseUrl: 'https://app.hyper-focus.invalid', now: () => clock },
      }),
    );
    try {
      const res = await fetch(`${s.baseUrl}${path}`, {
        method,
        headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: res.status, body: (await res.json()) as T };
    } finally {
      await s.close();
    }
  }
  type Today = { dayLabel: string; name: string; window: { start: string; end: string; taskId: number } | null; focus: { id: number; title: string; inWindow: boolean }[]; log: unknown[]; activeBlock: unknown };
  const today = async () => (await call<Today>('GET', '/api/today')).body;

  it('refuses without a session, and refuses changes that are not JSON', async () => {
    expect(await call('GET', '/api/today', undefined, {})).toEqual({ status: 401, body: { error: 'Niet ingelogd' } });
    const s = await startServer(createApp({ auth: { db: db(), dashboardBaseUrl: 'https://app.hyper-focus.invalid', now: () => clock, sendLoginMail: async () => undefined, findUserByEmail: async () => undefined }, dashboard: { db: db(), dashboardBaseUrl: 'https://app.hyper-focus.invalid', now: () => clock } }));
    try {
      const form = await fetch(`${s.baseUrl}/api/window`, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'time=14:00' });
      expect(form.status).toBe(415);
    } finally {
      await s.close();
    }
  });

  it('shows the day, the focus with the window task last, and the window in local time', async () => {
    const day = await today();
    expect(day.dayLabel).toBe('woensdag 7 oktober');
    expect(day.name).toBe('Sam');
    expect(day.window).toMatchObject({ start: '10:30', end: '12:00' });
    expect(day.focus.length).toBeGreaterThan(0);
    const last = day.focus.at(-1)!;
    expect(last.inWindow).toBe(true);
    expect(last.id).toBe(day.window!.taskId);
    expect(day.focus.filter((f) => f.inWindow)).toHaveLength(1);
    expect(day.log).toEqual([]);
    expect(day.activeBlock).toBeNull();
  });

  it('moves the window, and checks the time', async () => {
    expect(await call('POST', '/api/window', { time: '14:00' })).toEqual({ status: 200, body: { start: '14:00', end: '15:30' } });
    expect((await call('POST', '/api/window', { time: '25:00' })).status).toBe(400);
    expect((await today()).window).toMatchObject({ start: '14:00', end: '15:30' });
    const rows = await db().select().from(focusWindows).where(and(eq(focusWindows.userId, t.userId), eq(focusWindows.date, '2026-10-07')));
    expect(rows.map((r) => r.status).sort()).toEqual(['moved', 'planned']);
  });

  it('starts a block on a task, which then shows as the active block', async () => {
    const task = (await today()).focus[0]!;
    const started = await call<{ text: string }>('POST', `/api/tasks/${task.id}/start`, { minutes: 25 });
    expect(started.status).toBe(200);
    expect(started.body.text).toBe(`25 minuten voor ${task.title.toLowerCase()}. Ik meld me aan het eind.`);
    const [block] = await db().select().from(focusBlocks).where(eq(focusBlocks.userId, t.userId));
    expect(block?.taskId).toBe(task.id);
    expect((await today()).activeBlock).toMatchObject({ phase: 'block', taskId: task.id, endsAt: '09:25' });
    expect((await call('POST', `/api/tasks/${task.id}/start`, { minutes: 500 })).status).toBe(400);
  });

  it('marks a task done and moves another to tomorrow; foreign ids are not found', async () => {
    clock = at('2026-10-07', '08:00:00');
    const [first, second] = (await today()).focus;
    expect(await call('POST', `/api/tasks/${first!.id}/done`, {})).toEqual({ status: 200, body: { ok: true } });
    expect(await call('POST', `/api/tasks/${second!.id}/tomorrow`, {})).toEqual({ status: 200, body: { ok: true } });
    const ids = (await today()).focus.map((f) => f.id);
    expect(ids).not.toContain(first!.id);
    expect(ids).not.toContain(second!.id);
    const [done] = await db().select({ status: tasks.status }).from(tasks).where(eq(tasks.id, first!.id));
    expect(done?.status).toBe('done');
    expect((await call('POST', '/api/tasks/999999/done', {})).status).toBe(404);
  });
});
