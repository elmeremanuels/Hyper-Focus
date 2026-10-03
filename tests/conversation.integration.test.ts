import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAssistantRouter } from '../src/conversation/assistant.js';
import { handleButton } from '../src/conversation/buttons.js';
import { loadContext, MAX_CONTEXT_CHARS, renderContext } from '../src/conversation/context.js';
import { CORE_TOOLS, runTool, type ToolContext } from '../src/conversation/tools.js';
import { getSettings } from '../src/core/settings.js';
import { events, ideas, projects, tasks } from '../src/db/schema/index.js';
import { scriptedClaude } from './helpers/claude.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

// Wednesday 7 October 2026, 10:30 in Amsterdam.
const NOW = new Date('2026-10-07T08:30:00Z');

describe.skipIf(!adminUrl)('conversation layer (integration)', () => {
  const t = useTestDatabase();
  const ctx = (): ToolContext => ({
    db: t.connection.db,
    userId: t.userId,
    timezone: 'Europe/Amsterdam',
    now: NOW,
    source: 'telegram',
  });
  const projectId = async (title: string) =>
    (await t.connection.db.select().from(projects).where(eq(projects.title, title)))[0]!.id;
  const taskByTitle = async (title: string) =>
    (await t.connection.db.select().from(tasks).where(eq(tasks.title, title)))[0]!;

  it('puts a task about a client under that client\'s project', async () => {
    const outcome = await runTool(CORE_TOOLS, 'add_task', {
      title: 'Kerstbanner maken',
      estimated_minutes: 30,
      client_name: 'de bakker De Vries',
      due_date: '2026-10-09',
    }, ctx());
    expect(outcome.isError).toBeUndefined();
    const task = await taskByTitle('Kerstbanner maken');
    expect(task.projectId).toBe(await projectId('Website bakkerij'));
    expect(task.dueDate).toBe('2026-10-09');
    expect(task.source).toBe('telegram');
    expect(outcome.buttons).toEqual([{ id: `t:${task.id}:start`, title: 'Nu starten' }]);
  });

  it('sends an unclear task to Losse taken with project buttons', async () => {
    const outcome = await runTool(CORE_TOOLS, 'add_task', { title: 'Iets regelen', estimated_minutes: 15 }, ctx());
    const task = await taskByTitle('Iets regelen');
    expect(task.projectId).toBe(await projectId('Losse taken'));
    expect(outcome.buttons?.map((b) => b.id)).toEqual([
      `mv:${task.id}:${await projectId('Website bakkerij')}`,
      `mv:${task.id}:${await projectId('Nieuwsbrief Boho')}`,
      `mv:${task.id}:${await projectId('Onderhoud Fietsenmaker Jansen')}`,
    ]);

    const [reply] = await handleButton(outcome.buttons![1]!.id, ctx());
    expect(reply?.text).toBe('Staat nu bij Nieuwsbrief Boho.');
    expect((await taskByTitle('Iets regelen')).projectId).toBe(await projectId('Nieuwsbrief Boho'));
  });

  it('rejects invalid tool input before it runs', async () => {
    const outcome = await runTool(CORE_TOOLS, 'snooze', { task_id: 1, until_date: 'donderdag' }, ctx());
    expect(outcome).toMatchObject({ isError: true });
    expect(outcome.content).toMatch(/YYYY-MM-DD/);
  });

  it('snoozes a task until the start of a local day', async () => {
    const task = await taskByTitle('Banner voor de feestdagen');
    await runTool(CORE_TOOLS, 'snooze', { task_id: task.id, until_date: '2026-10-08' }, ctx());
    expect((await taskByTitle('Banner voor de feestdagen')).snoozedUntil?.toISOString()).toBe('2026-10-07T22:00:00.000Z');
  });

  it('keeps ideas out of tasks', async () => {
    const outcome = await runTool(CORE_TOOLS, 'add_idea', { text: 'Workshop voor bakkers' }, ctx());
    expect(outcome.reply?.text).toBe('Staat in je ideeënbak. Vrijdag kijken we ernaar.');
    const rows = await t.connection.db.select().from(ideas).where(eq(ideas.text, 'Workshop voor bakkers'));
    expect(rows).toHaveLength(1);
    expect(await t.connection.db.select().from(tasks).where(eq(tasks.title, 'Workshop voor bakkers'))).toHaveLength(0);
  });

  it('logs a note on the client of a project', async () => {
    const outcome = await runTool(CORE_TOOLS, 'log_note', { note: 'Anna belde', client_name: 'Bakkerij De Vries' }, ctx());
    expect(outcome.isError).toBeUndefined();
  });

  it('keeps the context within budget', async () => {
    const data = await loadContext(t.connection.db, t.userId, NOW);
    expect(data.today).toBe('2026-10-07');
    expect(data.clients).toContain('Boho Interieur (Mo)');
    expect(renderContext(data).length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
  });

  it('handles buttons without calling Claude', async () => {
    const claude = scriptedClaude([]);
    const router = createAssistantRouter({ db: t.connection.db, claude, now: () => NOW });
    const task = await taskByTitle('Factuur september versturen');

    const [reply] = await router({ kind: 'button', userId: t.userId, buttonId: `t:${task.id}:done`, title: 'Gedaan' });
    expect(reply?.text).toBe('Factuur september versturen is af.');
    expect((await taskByTitle('Factuur september versturen')).status).toBe('done');

    await router({ kind: 'button', userId: t.userId, buttonId: 'f:show', title: 'Laat zien' });
    await router({ kind: 'text', userId: t.userId, text: 'vandaag' });
    expect(claude.callWithTools).not.toHaveBeenCalled();
  });

  it('runs Claude\'s tool calls and feeds the results back', async () => {
    const claude = scriptedClaude([
      { tools: [{ name: 'add_task', input: { title: 'Prijslijst online zetten', estimated_minutes: 30, client_name: 'Jansen' } }] },
      { text: 'Staat erin bij de fietsenmaker. Nu beginnen?' },
    ]);
    const router = createAssistantRouter({ db: t.connection.db, claude, now: () => NOW });
    const replies = await router({ kind: 'text', userId: t.userId, text: 'Kees wil zijn prijslijst online', source: 'email' });

    const task = await taskByTitle('Prijslijst online zetten');
    expect(task.projectId).toBe(await projectId('Onderhoud Fietsenmaker Jansen'));
    expect(task.source).toBe('email');
    expect(replies).toEqual([
      { text: 'Staat erin bij de fietsenmaker. Nu beginnen?', buttons: [{ id: `t:${task.id}:start`, title: 'Nu starten' }] },
    ]);

    const second = claude.callWithTools.mock.calls[1]![0];
    expect(second.tier).toBe('fast');
    expect(second.userId).toBe(t.userId);
    expect(second.system).toContain('assistent van Sam');
    expect(second.messages.at(-1)).toMatchObject({ role: 'user', content: [{ type: 'tool_result' }] });
  });

  it('stills the day on overwhelm with a fixed reply', async () => {
    const claude = scriptedClaude([{ text: 'Rustig aan', tools: [{ name: 'overwhelm', input: {} }] }]);
    const router = createAssistantRouter({ db: t.connection.db, claude, now: () => NOW });
    const replies = await router({ kind: 'text', userId: t.userId, text: 'ik trek het niet meer' });

    expect(replies).toEqual([{ text: 'Dank dat je het zegt. Ik zet vandaag alles stil. Morgen om 8:30 uur stuur ik één bericht.' }]);
    expect(claude.callWithTools).toHaveBeenCalledTimes(1);
    expect((await getSettings(t.connection.db, t.userId)).pausedUntil?.toISOString()).toBe('2026-10-07T22:00:00.000Z');
    const logged = await t.connection.db
      .select()
      .from(events)
      .where(and(eq(events.userId, t.userId), eq(events.name, 'overwhelm')));
    expect(logged).toHaveLength(1);
  });

  it('apologises when Claude fails', async () => {
    const claude = { callWithTools: async () => Promise.reject(new Error('overloaded')) };
    const router = createAssistantRouter({ db: t.connection.db, claude, now: () => NOW, log: { error: () => undefined, warn: () => undefined } });
    const [reply] = await router({ kind: 'text', userId: t.userId, text: 'hoi' });
    expect(reply?.text).toBe('Er ging iets mis aan mijn kant. Probeer het zo nog eens.');
  });
});
