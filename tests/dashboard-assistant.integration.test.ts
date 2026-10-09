import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { clients, ideas, tasks, users } from '../src/db/schema/index.js';
import { createSession } from '../src/web/auth/sessions.js';
import { scriptedClaude } from './helpers/claude.js';
import { startServer } from './helpers/server.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

const BASE = 'https://app.hyper-focus.invalid';
const BRAINDUMP = 'Morgen factuur Boho sturen. Anna van de bakkerij wil de site voor de feestdagen live. Ooit een podcast.';

describe.skipIf(!adminUrl)('dashboard: assistant Kiki (integration)', () => {
  const t = useTestDatabase();
  const db = () => t.connection.db;
  const clock = new Date('2026-10-07T07:00:00Z');
  let cookie = '';

  beforeAll(async () => {
    cookie = `hf_session=${(await createSession(db(), t.userId, clock)).token}`;
  });

  async function call<T = unknown>(claude: ReturnType<typeof scriptedClaude> | undefined, path: string, body?: unknown) {
    const s = await startServer(createApp({ dashboard: { db: db(), dashboardBaseUrl: BASE, claude, now: () => clock } }));
    try {
      const res = await fetch(`${s.baseUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: res.status, body: (await res.json()) as T };
    } finally {
      await s.close();
    }
  }
  type Plan = { reply: string; items: Array<Record<string, unknown> & { kind: string; where: string | null }>; crisis?: boolean };

  const proposal = {
    reply: 'Ik zie een taak, een notitie en een idee.',
    items: [
      { kind: 'task', title: 'Factuur sturen aan Boho', estimated_minutes: 15, client_name: 'Boho', due_date: '2026-10-08', work_type: 'invoicing' },
      { kind: 'note', note: 'Anna wil de site voor de feestdagen live.', client_name: 'de bakker' },
      { kind: 'idea', text: 'Een podcast beginnen' },
      { kind: 'task', title: 'x' }, // invalid: dropped
    ],
  };

  it('says it is off without Claude, and needs a session', async () => {
    expect((await call(undefined, '/api/assistant')).body).toEqual({ name: 'Kiki', available: false, maxChars: 6000 });
    expect((await call(undefined, '/api/assistant/plan', { text: BRAINDUMP })).status).toBe(503);
    cookie = '';
    expect((await call(undefined, '/api/assistant')).status).toBe(401);
    cookie = `hf_session=${(await createSession(db(), t.userId, clock)).token}`;
  });

  it('proposes items with the smart model and saves nothing yet', async () => {
    const claude = scriptedClaude([{ tools: [{ name: 'propose_items', input: proposal }] }]);
    const before = (await db().select().from(tasks)).length;
    const plan = await call<Plan>(claude, '/api/assistant/plan', { text: BRAINDUMP });
    expect(plan.status).toBe(200);
    expect(plan.body.reply).toBe('Ik zie een taak, een notitie en een idee.');
    expect(plan.body.items.map((i) => [i.kind, i.where])).toEqual([
      ['task', 'Boho Interieur'],
      ['note', 'Bakkerij De Vries'],
      ['idea', null],
    ]);
    expect((await db().select().from(tasks)).length).toBe(before);

    const options = claude.callWithTools.mock.calls[0]![0];
    expect(options).toMatchObject({ tier: 'smart', purpose: 'braindump', forceTool: 'propose_items', messages: [{ role: 'user', content: BRAINDUMP }] });
    expect(options.system).toContain('Je bent Kiki');
    expect(options.system).toContain('Bakkerij De Vries');
    expect(options.tools[0]?.name).toBe('propose_items');
  });

  it('saves the confirmed items with the router tools', async () => {
    const items = proposal.items.slice(0, 3).map((i) => (i.kind === 'task' ? { ...i, title: 'Factuur september sturen aan Boho' } : i));
    const res = await call<{ saved: number; results: Array<{ ok: boolean }> }>(undefined, '/api/assistant/apply', { items });
    expect(res.body.saved).toBe(3);

    const [task] = await db().select().from(tasks).where(eq(tasks.title, 'Factuur september sturen aan Boho'));
    expect(task).toMatchObject({ estimatedMinutes: 15, dueDate: '2026-10-08', source: 'web', workType: 'invoicing' });
    const [bakery] = await db().select().from(clients).where(eq(clients.name, 'Bakkerij De Vries'));
    expect(bakery?.notes).toContain('[2026-10-07] Anna wil de site voor de feestdagen live.');
    const [idea] = await db().select().from(ideas).where(eq(ideas.text, 'Een podcast beginnen'));
    expect(idea?.source).toBe('web');
  });

  it('reports an item that cannot be saved, and refuses invalid items', async () => {
    const res = await call<{ saved: number; results: Array<{ ok: boolean; error?: string }> }>(undefined, '/api/assistant/apply', {
      items: [{ kind: 'note', note: 'Zonder klant of project.' }, { kind: 'idea', text: 'Workshop' }],
    });
    expect(res.body.saved).toBe(1);
    expect(res.body.results[0]).toMatchObject({ ok: false });
    expect((await call(undefined, '/api/assistant/apply', { items: [{ kind: 'task', title: 'Iets doen', estimated_minutes: 20 }] })).status).toBe(400);
    expect((await call(undefined, '/api/assistant/apply', { items: [] })).status).toBe(400);
  });

  it('limits the length, and the number of proposals per hour', async () => {
    const claude = scriptedClaude(Array.from({ length: 30 }, () => ({ tools: [{ name: 'propose_items', input: { reply: '', items: [] } }] })));
    expect((await call(claude, '/api/assistant/plan', { text: 'a'.repeat(6001) })).status).toBe(400);
    const empty = await call<Plan>(claude, '/api/assistant/plan', { text: 'hmm' });
    expect(empty.body).toEqual({ reply: 'Ik vond niets om op te slaan. Wil je het anders opschrijven?', items: [] });
    let status = 200;
    for (let i = 0; i < 20 && status === 200; i++) status = (await call(claude, '/api/assistant/plan', { text: 'hmm' })).status;
    expect(status).toBe(429);
  });

  it('stops and points to help on signs of despair', async () => {
    const claude = scriptedClaude([]);
    const res = await call<Plan>(claude, '/api/assistant/plan', { text: 'Ik wil dood, alles is te veel.' });
    expect(res.body).toMatchObject({ items: [], crisis: true });
    expect(res.body.reply).toContain('113');
    expect(claude.callWithTools).not.toHaveBeenCalled();
    expect((await db().select({ status: users.status }).from(users).where(eq(users.id, t.userId)))[0]?.status).toBe('paused');
  });
});
