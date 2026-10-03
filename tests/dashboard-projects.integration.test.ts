import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { clients, projects, tasks, users } from '../src/db/schema/index.js';
import { createSession } from '../src/web/auth/sessions.js';
import { startServer } from './helpers/server.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

const BASE = 'https://app.hyper-focus.invalid';

describe.skipIf(!adminUrl)('dashboard: Projecten & klanten (integration)', () => {
  const t = useTestDatabase();
  const db = () => t.connection.db;
  const clock = new Date('2026-10-07T07:00:00Z');
  let cookie = '';
  let otherProjectId = 0;

  beforeAll(async () => {
    cookie = `hf_session=${(await createSession(db(), t.userId, clock)).token}`;
    // Someone else's project, to check that ids from another user are refused.
    const [other] = await db().insert(users).values({ name: 'Ander', email: 'ander@voorbeeld.invalid' }).returning({ id: users.id });
    const [project] = await db().insert(projects).values({ userId: other!.id, title: 'Niet van jou' }).returning({ id: projects.id });
    otherProjectId = project!.id;
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
  type Overview = {
    projects: Array<{ id: number; title: string; client: string | null; loose: boolean; isWeeklyFocus: boolean; deadline: string | null; status: string; tasks: Array<{ id: number; title: string; minutes: number | null }> }>;
    clients: Array<{ id: number; name: string; notes: string | null; projects: number }>;
  };
  const overview = async () => (await call<Overview>('GET', '/api/projects')).body;

  it('lists projects with their open tasks, loose tasks last, and the clients', async () => {
    const o = await overview();
    expect(o.projects.length).toBeGreaterThan(1);
    expect(o.projects.at(-1)).toMatchObject({ title: 'Losse taken', loose: true });
    expect(o.projects.filter((p) => p.loose)).toHaveLength(1);
    const offerte = o.projects.find((p) => p.tasks.some((task) => task.title === 'Offerte bakkerij afmaken'));
    expect(offerte?.client).toBe('Bakkerij De Vries');
    expect(o.clients.map((c) => c.name)).toContain('Bakkerij De Vries');
    expect(o.projects.some((p) => p.title === 'Niet van jou')).toBe(false);
  });

  it('adds a client and a project for it, then a task in that project', async () => {
    const client = await call<{ id: number }>('POST', '/api/clients', { name: 'Fietsenmaker Jansen', contactName: 'Joop' });
    expect(client.status).toBe(201);
    const project = await call<{ id: number }>('POST', '/api/projects', { title: 'Nieuwe website', clientId: client.body.id });
    expect(project.status).toBe(201);
    const task = await call<{ id: number }>('POST', `/api/projects/${project.body.id}/tasks`, { title: 'Sitemap maken', minutes: 30 });
    expect(task.status).toBe(201);
    const [row] = await db().select().from(tasks).where(eq(tasks.id, task.body.id));
    expect(row).toMatchObject({ title: 'Sitemap maken', estimatedMinutes: 30, source: 'web', userId: t.userId });

    const o = await overview();
    expect(o.projects.find((p) => p.id === project.body.id)).toMatchObject({ client: 'Fietsenmaker Jansen', tasks: [{ title: 'Sitemap maken', minutes: 30 }] });
    expect(o.clients.find((c) => c.id === client.body.id)?.projects).toBe(1);
  });

  it('edits a project, but keeps Losse taken as it is', async () => {
    const o = await overview();
    const project = o.projects.find((p) => !p.loose)!;
    expect((await call('PATCH', `/api/projects/${project.id}`, { title: 'Hernoemd', deadline: '2026-10-30', isWeeklyFocus: true })).status).toBe(200);
    const [row] = await db().select().from(projects).where(eq(projects.id, project.id));
    expect(row).toMatchObject({ title: 'Hernoemd', deadline: '2026-10-30', isWeeklyFocus: true });

    const loose = o.projects.find((p) => p.loose)!;
    expect((await call('PATCH', `/api/projects/${loose.id}`, { title: 'Iets anders' })).status).toBe(400);
    expect((await call('PATCH', `/api/projects/${loose.id}`, { deadline: '2026-11-01' })).status).toBe(200);
    expect((await call('PATCH', `/api/projects/${project.id}`, { priority: 7 })).status).toBe(400);
    expect((await call('PATCH', `/api/projects/${otherProjectId}`, { title: 'Van mij' })).status).toBe(404);
  });

  it('edits a task and moves it, with its micro steps, to another project', async () => {
    const o = await overview();
    const [from, to] = o.projects.filter((p) => p.tasks.length > 0 || p.loose);
    const task = from!.tasks[0]!;
    const [step] = await db().insert(tasks).values({ userId: t.userId, projectId: from!.id, parentTaskId: task.id, title: 'Eerste stapje', source: 'web' }).returning({ id: tasks.id });

    expect((await call('PATCH', `/api/tasks/${task.id}`, { title: 'Nieuwe titel', minutes: 15, dueDate: '2026-10-09', projectId: to!.id })).status).toBe(200);
    const [row] = await db().select().from(tasks).where(eq(tasks.id, task.id));
    expect(row).toMatchObject({ title: 'Nieuwe titel', estimatedMinutes: 15, dueDate: '2026-10-09', projectId: to!.id });
    const [moved] = await db().select().from(tasks).where(eq(tasks.id, step!.id));
    expect(moved?.projectId).toBe(to!.id);

    expect((await call('PATCH', `/api/tasks/${task.id}`, { minutes: 20 })).status).toBe(400);
    expect((await call('PATCH', `/api/tasks/${task.id}`, { projectId: otherProjectId })).status).toBe(404);
  });

  it('parks a task, and edits a client note', async () => {
    const o = await overview();
    const task = o.projects.flatMap((p) => p.tasks)[0]!;
    expect((await call('POST', `/api/tasks/${task.id}/park`, {})).status).toBe(200);
    expect((await overview()).projects.flatMap((p) => p.tasks).some((x) => x.id === task.id)).toBe(false);

    const client = o.clients[0]!;
    expect((await call('PATCH', `/api/clients/${client.id}`, { notes: 'Belt liever dan mailt.' })).status).toBe(200);
    const [row] = await db().select().from(clients).where(eq(clients.id, client.id));
    expect(row?.notes).toBe('Belt liever dan mailt.');
  });
});
