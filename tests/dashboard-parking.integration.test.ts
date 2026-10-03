import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ideas, projects, tasks } from '../src/db/schema/index.js';
import { createSession } from '../src/web/auth/sessions.js';
import { startServer } from './helpers/server.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

const BASE = 'https://app.hyper-focus.invalid';

describe.skipIf(!adminUrl)('dashboard: Parkeerplaats & ideeënbak (integration)', () => {
  const t = useTestDatabase();
  const db = () => t.connection.db;
  let clock = new Date('2026-10-07T07:00:00Z');
  let cookie = '';

  beforeAll(async () => {
    cookie = `hf_session=${(await createSession(db(), t.userId, clock)).token}`;
  });

  async function call<T = unknown>(method: string, path: string, body?: unknown) {
    const s = await startServer(createApp({ dashboard: { db: db(), dashboardBaseUrl: BASE, now: () => clock } }));
    try {
      const res = await fetch(`${s.baseUrl}${path}`, {
        method,
        headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: res.status, body: (await res.json()) as T };
    } finally {
      await s.close();
    }
  }
  type Parking = { parked: Array<{ id: number; title: string }>; ideas: Array<{ id: number; text: string; date: string }>; canPromote: boolean };
  const parking = async () => (await call<Parking>('GET', '/api/parking')).body;
  const firstOpenTask = async () => (await db().select().from(tasks).where(eq(tasks.status, 'open')))[0]!;

  it('lists parked tasks, and brings one back or lets one go', async () => {
    const task = await firstOpenTask();
    expect((await call('POST', `/api/tasks/${task.id}/unpark`, {})).status).toBe(404); // not parked
    expect((await call('POST', `/api/tasks/${task.id}/park`, {})).status).toBe(200);
    expect((await parking()).parked.map((p) => p.id)).toContain(task.id);

    expect((await call('POST', `/api/tasks/${task.id}/unpark`, {})).status).toBe(200);
    expect((await db().select().from(tasks).where(eq(tasks.id, task.id)))[0]?.status).toBe('open');

    await call('POST', `/api/tasks/${task.id}/park`, {});
    expect((await call('POST', `/api/tasks/${task.id}/release`, {})).status).toBe(200);
    expect((await db().select().from(tasks).where(eq(tasks.id, task.id)))[0]?.status).toBe('released');
    expect((await parking()).parked.map((p) => p.id)).not.toContain(task.id);
  });

  it('adds, edits and archives an idea', async () => {
    const added = await call<{ id: number }>('POST', '/api/ideas', { text: 'Podcast over ondernemen' });
    expect(added.status).toBe(201);
    expect((await call('PATCH', `/api/ideas/${added.body.id}`, { text: 'Podcast met klanten' })).status).toBe(200);
    expect((await parking()).ideas).toContainEqual(expect.objectContaining({ id: added.body.id, text: 'Podcast met klanten' }));
    expect((await call('PATCH', `/api/ideas/${added.body.id}`, { text: '  ' })).status).toBe(400);

    expect((await call('POST', `/api/ideas/${added.body.id}/archive`, {})).status).toBe(200);
    expect((await parking()).ideas.map((i) => i.id)).not.toContain(added.body.id);
    expect((await db().select().from(ideas).where(eq(ideas.id, added.body.id)))[0]?.source).toBe('web');
  });

  it('promotes one idea a week to a project', async () => {
    const a = await call<{ id: number }>('POST', '/api/ideas', { text: 'Workshop voor starters' });
    const b = await call<{ id: number }>('POST', '/api/ideas', { text: 'Nieuwsbrief in het Engels' });
    expect((await parking()).canPromote).toBe(true);

    const promoted = await call<{ projectId: number; title: string }>('POST', `/api/ideas/${a.body.id}/promote`, {});
    expect(promoted).toMatchObject({ status: 200, body: { title: 'Workshop voor starters' } });
    const [project] = await db().select().from(projects).where(eq(projects.id, promoted.body.projectId));
    expect(project).toMatchObject({ title: 'Workshop voor starters', priority: 3, userId: t.userId });

    expect((await parking()).canPromote).toBe(false);
    expect((await call('POST', `/api/ideas/${b.body.id}/promote`, {})).status).toBe(409);
    expect((await call('POST', `/api/ideas/${a.body.id}/promote`, {})).status).toBe(404);

    clock = new Date('2026-10-14T08:00:00Z');
    expect((await call('POST', `/api/ideas/${b.body.id}/promote`, {})).status).toBe(200);
  });
});
