import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAssistantRouter } from '../src/conversation/assistant.js';
import { events, tasks, userTools } from '../src/db/schema/index.js';
import { LINK_REJECTED, WORK_TYPES } from '../src/tools/catalog.js';
import { scriptedClaude } from './helpers/claude.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

const NOW = new Date('2026-10-07T08:30:00Z');

describe.skipIf(!adminUrl)('workplace links (integration)', () => {
  const t = useTestDatabase();
  const db = () => t.connection.db;
  const router = (claude = scriptedClaude([])) => createAssistantRouter({ db: db(), claude, now: () => NOW });
  const tap = (r: ReturnType<typeof router>, id: string) => r({ kind: 'button', userId: t.userId, buttonId: id, title: id });
  const say = (r: ReturnType<typeof router>, text: string) => r({ kind: 'text', userId: t.userId, text });

  it('walks through the six questions; skip, start page and a pasted link work', async () => {
    const r = router();
    const [none] = await say(r, 'mijn tools');
    expect(none?.text).toBe('Je hebt nog geen tools ingesteld.');

    const asked: string[] = [];
    let [q] = await tap(r, 'tl:start');
    asked.push(q?.text ?? '');
    expect(q?.choices?.map((c) => c.title)).toEqual(['Moneybird', 'e-Boekhouden', 'Jortt', 'Exact Online', 'Overslaan', 'Anders: plak je link']);

    // Facturen: Moneybird, then a pasted link to the new-invoice screen.
    const [paste] = await tap(r, 'tl:invoicing:pick:moneybird');
    expect(paste?.text).toBe('Wil je de link plakken van het scherm waar je begint, bijvoorbeeld "nieuwe factuur"? Dan kom je straks direct op de goede plek.');
    expect(paste?.buttons?.map((b) => b.title)).toEqual(['Plak link', 'Gebruik de startpagina']);
    await tap(r, 'tl:invoicing:paste');
    const [rejected] = await say(r, 'http://moneybird.com/123/sales_invoices/new');
    expect(rejected?.text).toBe(LINK_REJECTED);
    [q] = await say(r, 'https://moneybird.com/123/sales_invoices/new');
    asked.push(q?.text ?? '');

    // Mail: Gmail with the start page. Agenda: skip. Posts: own tool via a link.
    await tap(r, 'tl:email:pick:gmail');
    [q] = await tap(r, 'tl:email:keep');
    asked.push(q?.text ?? '');
    [q] = await tap(r, 'tl:calendar:skip');
    asked.push(q?.text ?? '');
    await tap(r, 'tl:content:other');
    [q] = await say(r, 'https://app.postplanner.voorbeeld.nl/nieuw');
    asked.push(q?.text ?? '');
    // WordPress has no start page: only paste or skip.
    const [wp] = await tap(r, 'tl:website:pick:wordpress');
    expect(wp?.buttons?.map((b) => b.title)).toEqual(['Plak link', 'Overslaan']);
    [q] = await tap(r, 'tl:website:skip');
    asked.push(q?.text ?? '');
    const [done] = await tap(r, 'tl:docs:skip');
    expect(done?.text).toBe('Klaar. Stuur "mijn tools" als je iets wilt wijzigen.');

    expect(asked).toHaveLength(WORK_TYPES.length);
    const saved = await db().select().from(userTools).where(eq(userTools.userId, t.userId));
    expect(saved.map((s) => [s.workType, s.label, s.url]).sort()).toEqual([
      ['content', 'voorbeeld.nl', 'https://app.postplanner.voorbeeld.nl/nieuw'],
      ['email', 'Gmail', 'https://mail.google.com/'],
      ['invoicing', 'Moneybird', 'https://moneybird.com/123/sales_invoices/new'],
    ]);
  });

  it('shows [Open Moneybird → nieuwe factuur] on a new invoice task, and no button without a kind of work', async () => {
    const claude = scriptedClaude([
      { tools: [{ name: 'add_task', input: { title: 'Factuur naar Barbara versturen', estimated_minutes: 15, work_type: 'invoicing' } }] },
      { text: 'Staat erin.' },
      { tools: [{ name: 'add_task', input: { title: 'Nadenken over de jaarplanning', estimated_minutes: 30 } }] },
      { text: 'Staat erin.' },
    ]);
    const r = router(claude);
    const [reply] = await say(r, 'morgen factuur naar Barbara versturen');
    const link = reply?.buttons?.find((b) => b.url);
    expect(link).toMatchObject({ title: 'Open Moneybird → nieuwe factuur', url: 'https://moneybird.com/123/sales_invoices/new' });
    const [task] = await db().select().from(tasks).where(eq(tasks.title, 'Factuur naar Barbara versturen'));
    expect(task?.workType).toBe('invoicing');
    const shown = await db().select().from(events).where(and(eq(events.userId, t.userId), eq(events.name, 'tool_button_shown')));
    expect(shown.map((e) => e.props)).toContainEqual({ taskId: task?.id, workType: 'invoicing' });

    const [plain] = await say(r, 'nadenken over de jaarplanning');
    expect(plain?.buttons?.some((b) => b.url)).toBe(false);
  });

  it('asks at most once a week for a tool that is missing', async () => {
    const claude = scriptedClaude([
      { tools: [{ name: 'add_task', input: { title: 'Contract voor Boho opstellen', estimated_minutes: 30, work_type: 'docs' } }] },
      { text: 'Staat erin.' },
      { tools: [{ name: 'add_task', input: { title: 'Offerte-document bijwerken', estimated_minutes: 15, work_type: 'docs' } }] },
      { text: 'Staat erin.' },
    ]);
    const r = router(claude);
    const first = await say(r, 'contract voor boho opstellen');
    expect(first[1]?.text).toBe('Ik zag een document-taak. Waar staan je documenten?');
    expect(first[1]?.choices?.map((c) => c.title)).toContain('Notion');
    await tap(r, 'tl:docs:skip');
    const second = await say(r, 'offerte document bijwerken');
    expect(second).toHaveLength(1);
  });

  it('lists the tools with change and remove per line', async () => {
    const r = router();
    const [overview] = await say(r, 'mijn tools');
    expect(overview?.text).toBe('Je tools:\nFacturen: Moneybird\nMail: Gmail\nPosts: voorbeeld.nl');
    expect(overview?.rows?.[0]?.map((b) => b.id)).toEqual(['tl:invoicing:edit', 'tl:invoicing:del']);
    expect(overview?.rows?.at(-1)?.[0]?.id).toBe('tl:missing');

    const [after] = await tap(r, 'tl:content:del');
    expect(after?.text).toBe('Verwijderd.\nJe tools:\nFacturen: Moneybird\nMail: Gmail');
  });
});
