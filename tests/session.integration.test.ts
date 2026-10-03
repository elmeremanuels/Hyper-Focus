import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAssistantRouter } from '../src/conversation/assistant.js';
import { STUCK_TEXT } from '../src/conversation/session.js';
import { getState } from '../src/conversation/state.js';
import { createDbMessageStore } from '../src/core/messages.js';
import { createDbUserStore } from '../src/core/users.js';
import { scheduledNudges, tasks, users } from '../src/db/schema/index.js';
import { sendDueNudges } from '../src/proactive/sender.js';
import { scriptedClaude } from './helpers/claude.js';
import { fakeDelivery } from './helpers/delivery.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

const NOW = new Date('2026-10-07T08:30:00Z');
const steps = (...titles: string[]) => titles.map((title, i) => ({ title, minutes: i === 0 ? 5 : 15 }));

describe.skipIf(!adminUrl)('break down and body double (integration)', () => {
  const t = useTestDatabase();
  const db = () => t.connection.db;
  const byTitle = async (title: string) => (await db().select().from(tasks).where(eq(tasks.title, title)))[0]!;
  const childrenOf = async (id: number) =>
    (await db().select().from(tasks).where(eq(tasks.parentTaskId, id))).sort((a, b) => a.id - b.id);
  const checkins = async () =>
    db()
      .select()
      .from(scheduledNudges)
      .where(and(eq(scheduledNudges.userId, t.userId), eq(scheduledNudges.kind, 'session_checkin')));
  const tap = (router: ReturnType<typeof createAssistantRouter>, buttonId: string) =>
    router({ kind: 'button', userId: t.userId, buttonId, title: buttonId });

  it('breaks "help me starten met X" into 3–5 steps with a short first step', async () => {
    const claude = scriptedClaude([
      {
        tools: [
          {
            name: 'break_down',
            input: { title: 'Jaarplanning maken', steps: steps('Open een leeg document', 'Zet de vier kwartalen erin', 'Kies per kwartaal één doel', 'Plan de eerste maand') },
          },
        ],
      },
    ]);
    const router = createAssistantRouter({ db: db(), claude, now: () => NOW });
    const [reply] = await router({ kind: 'text', userId: t.userId, text: 'help me starten met de jaarplanning' });

    const parent = await byTitle('Jaarplanning maken');
    const children = await childrenOf(parent.id);
    expect(children.map((c) => [c.title, c.estimatedMinutes])).toEqual([
      ['Open een leeg document', 5],
      ['Zet de vier kwartalen erin', 15],
      ['Kies per kwartaal één doel', 15],
      ['Plan de eerste maand', 15],
    ]);
    expect(reply?.text).toContain('1. Open een leeg document · 5 min');
    expect(reply?.buttons?.[0]).toEqual({ id: `t:${parent.id}:start`, title: 'Start stap 1' });
    expect(claude.callWithTools).toHaveBeenCalledTimes(1);
  });

  it('rejects a first step longer than 10 minutes or fewer than 3 steps', async () => {
    const claude = scriptedClaude([
      { tools: [{ name: 'break_down', input: { title: 'Iets groots', steps: [{ title: 'Alles in één keer doen', minutes: 30 }, ...steps('a b c', 'd e f')] } }] },
      { text: 'Dat lukte niet.' },
    ]);
    const router = createAssistantRouter({ db: db(), claude, now: () => NOW });
    await router({ kind: 'text', userId: t.userId, text: 'knip iets groots op' });
    const second = claude.callWithTools.mock.calls[1]![0];
    expect(JSON.stringify(second.messages.at(-1))).toContain('hooguit 10 minuten');
    expect(await db().select().from(tasks).where(eq(tasks.title, 'Iets groots'))).toHaveLength(0);
  });

  it('starts a session, checks in after the set minutes and celebrates done', async () => {
    const router = createAssistantRouter({ db: db(), claude: scriptedClaude([]), now: () => NOW });
    const banner = await byTitle('Banner voor de feestdagen');

    const [started] = await tap(router, `t:${banner.id}:start`);
    expect(started?.text).toBe('Top. Eén stap: banner voor de feestdagen. Ik check over 25 minuten bij je.');
    expect((await getState(db(), t.userId, NOW)).mode).toBe('session');
    const [checkin] = (await checkins()).filter((n) => n.status === 'pending');
    expect(checkin?.scheduledForUtc.toISOString()).toBe('2026-10-07T08:55:00.000Z');

    await db().update(users).set({ telegramChatId: 777 }).where(eq(users.id, t.userId));
    const { delivery, telegram } = fakeDelivery(createDbMessageStore(db()));
    const deps = { db: db(), delivery, users: createDbUserStore(db()) };
    expect((await sendDueNudges(deps, new Date('2026-10-07T08:54:00Z'))).sent).toBe(0);
    expect((await sendDueNudges(deps, new Date('2026-10-07T08:55:30Z'))).sent).toBe(1);
    const sent = telegram.sent().at(-1)?.body;
    expect(sent?.text).toBe('Hoe ging het met banner voor de feestdagen?');
    expect(JSON.stringify(sent?.reply_markup)).toContain(`sess:${banner.id}:stuck`);

    const [done] = await tap(router, `sess:${banner.id}:done`);
    expect(done?.text).toBe('✔ Banner voor de feestdagen is af.');
    expect((await byTitle('Banner voor de feestdagen')).status).toBe('done');
    expect((await getState(db(), t.userId, NOW)).mode).toBe('idle');
  });

  it('adds ten minutes', async () => {
    const router = createAssistantRouter({ db: db(), claude: scriptedClaude([]), now: () => NOW });
    const task = await byTitle('Onderwerpregels nieuwsbrief kiezen');
    await tap(router, `t:${task.id}:start`);
    const [reply] = await tap(router, `sess:${task.id}:plus10`);
    expect(reply?.text).toBe('Prima, nog 10 minuten. Ik check zo bij je.');
    const pending = (await checkins()).filter((n) => n.status === 'pending');
    expect(pending.map((n) => n.scheduledForUtc.toISOString())).toEqual(['2026-10-07T08:40:00.000Z']);
  });

  it('makes a step smaller when stuck, and moves on through the steps', async () => {
    const offerte = await byTitle('Offerte bakkerij afmaken');
    const [first] = await childrenOf(offerte.id);
    const claude = scriptedClaude([
      { tools: [{ name: 'break_down', input: { steps: steps('Zoek de offerte van vorig jaar', 'Kopieer de opbouw', 'Schrijf één zin over de bakkerij') } }] },
    ]);
    const router = createAssistantRouter({ db: db(), claude, now: () => NOW });

    const [started] = await tap(router, `t:${offerte.id}:start`);
    expect(started?.text).toBe(`Top. Eén stap: ${first!.title.charAt(0).toLowerCase()}${first!.title.slice(1)}. Ik check over 25 minuten bij je.`);

    const [stuck] = await tap(router, `sess:${offerte.id}:stuck`);
    expect(stuck?.text).toBe(STUCK_TEXT);
    const replies = await router({ kind: 'text', userId: t.userId, text: 'ik weet niet hoe ik moet beginnen' });
    expect(claude.callWithTools.mock.calls[0]![0]).toMatchObject({ purpose: 'break_down', forceTool: 'break_down' });
    expect(replies[0]?.text).toContain('Kleiner dan:\n1. Zoek de offerte van vorig jaar · 5 min');
    expect(replies[1]?.text).toBe('Top. Eén stap: zoek de offerte van vorig jaar. Ik check over 25 minuten bij je.');

    // Finishing the three smaller steps finishes the step they came from.
    for (let i = 0; i < 3; i++) {
      await tap(router, `sess:${offerte.id}:done`);
      if (i < 2) await tap(router, `t:${offerte.id}:start`);
    }
    expect((await db().select().from(tasks).where(eq(tasks.id, first!.id)))[0]?.status).toBe('done');
    const [last] = await tap(router, `t:${offerte.id}:start`);
    expect(last?.text).toContain('zet de drie pakketten met prijs erin');
  });

  it('suggests a break after the third session of the day', async () => {
    const router = createAssistantRouter({ db: db(), claude: scriptedClaude([]), now: () => NOW });
    const offerte = await byTitle('Offerte bakkerij afmaken');
    // Sessions done today so far: banner and three small steps = 4; this makes 5, then 6.
    await tap(router, `sess:${offerte.id}:done`);
    await tap(router, `t:${offerte.id}:start`);
    const [reply] = await tap(router, `sess:${offerte.id}:done`);
    expect(reply?.text).toContain('Tijd voor een pauze?');
  });

  it('splits a big task with Claude before the first session', async () => {
    const claude = scriptedClaude([
      { tools: [{ name: 'break_down', input: { steps: steps('Maak een lijst van de pagina\'s', 'Schrijf de homepage', 'Schrijf de contactpagina') } }] },
    ]);
    const router = createAssistantRouter({ db: db(), claude, now: () => NOW });
    const site = await byTitle('Openingstijden op de site bijwerken');
    await db().update(tasks).set({ estimatedMinutes: 120, title: 'Teksten nieuwe site' }).where(eq(tasks.id, site.id));

    const replies = await tap(router, `t:${site.id}:start`);
    expect(replies[0]?.text).toContain('Zo knippen we teksten nieuwe site op:');
    expect(replies[1]?.text).toBe("Top. Eén stap: maak een lijst van de pagina's. Ik check over 25 minuten bij je.");
    expect(await childrenOf(site.id)).toHaveLength(3);
  });
});
