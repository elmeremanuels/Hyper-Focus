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

  it('asks the length, starts a block, ends it with a question and starts the pause', async () => {
    const router = createAssistantRouter({ db: db(), claude: scriptedClaude([]), now: () => NOW });
    const banner = await byTitle('Banner voor de feestdagen');

    const [asked] = await tap(router, `t:${banner.id}:start`);
    expect(asked?.text).toBe('Hoe lang ga je aan banner voor de feestdagen?');
    expect(asked?.buttons?.map((b) => b.id)).toEqual([`blk:t${banner.id}:m15`, `blk:t${banner.id}:m25`, `blk:t${banner.id}:m45`]);

    const [started] = await tap(router, `blk:t${banner.id}:m25`);
    expect(started?.text).toBe('Top. 25 minuten voor banner voor de feestdagen. Ik meld me aan het eind.');
    expect((await getState(db(), t.userId, NOW)).mode).toBe('session');
    const ends = await db().select().from(scheduledNudges).where(and(eq(scheduledNudges.userId, t.userId), eq(scheduledNudges.kind, 'block_end')));
    expect(ends.map((n) => n.scheduledForUtc.toISOString())).toEqual(['2026-10-07T08:55:00.000Z']);

    await db().update(users).set({ telegramChatId: 777 }).where(eq(users.id, t.userId));
    const { delivery, telegram } = fakeDelivery(createDbMessageStore(db()));
    const deps = { db: db(), delivery, users: createDbUserStore(db()) };
    expect((await sendDueNudges(deps, new Date('2026-10-07T08:54:00Z'))).sent).toBe(0);
    expect((await sendDueNudges(deps, new Date('2026-10-07T08:55:30Z'))).sent).toBe(1);
    const sent = telegram.sent().at(-1)?.body;
    expect(sent?.text).toBe('Je 25 minuten zitten erop. Hoe ging het?');
    expect(JSON.stringify(sent?.reply_markup)).toContain('Afgerond');
    expect(sent?.disable_notification).toBeUndefined();

    const blockId = Number(/blk:(\d+):done/.exec(JSON.stringify(sent?.reply_markup))?.[1]);
    const later = createAssistantRouter({ db: db(), claude: scriptedClaude([]), now: () => new Date('2026-10-07T08:56:00Z') });
    const [pause] = await tap(later, `blk:${blockId}:done`);
    expect(pause?.text).toMatch(/^Mooi gewerkt\. .* Je telefoon blijft liggen\. Over [23] minuten zie ik je terug\.$/);
    expect((await getState(db(), t.userId, new Date('2026-10-07T08:56:00Z'))).data).toMatchObject({ phase: 'pause', blockId });
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

    const [started] = await tap(router, `blk:t${offerte.id}:m15`);
    expect(started?.text).toBe(
      `Top. 15 minuten voor offerte bakkerij afmaken. Ik meld me aan het eind.\nEerste stap: ${first!.title.charAt(0).toLowerCase()}${first!.title.slice(1)}.`,
    );

    const [stuck] = await tap(router, `sess:${offerte.id}:stuck`);
    expect(stuck?.text).toBe(STUCK_TEXT);
    const replies = await router({ kind: 'text', userId: t.userId, text: 'ik weet niet hoe ik moet beginnen' });
    expect(claude.callWithTools.mock.calls[0]![0]).toMatchObject({ purpose: 'break_down', forceTool: 'break_down' });
    expect(replies[0]?.text).toContain('Kleiner dan:\n1. Zoek de offerte van vorig jaar · 5 min');
    expect(replies[1]?.text).toBe('Top. 15 minuten voor offerte bakkerij afmaken. Ik meld me aan het eind.\nEerste stap: zoek de offerte van vorig jaar.');

    // Finishing the three smaller steps finishes the step they came from.
    for (let i = 0; i < 3; i++) {
      await tap(router, `sess:${offerte.id}:done`);
      if (i < 2) await tap(router, `blk:t${offerte.id}:m15`);
    }
    expect((await db().select().from(tasks).where(eq(tasks.id, first!.id)))[0]?.status).toBe('done');
    const [last] = await tap(router, `blk:t${offerte.id}:m15`);
    expect(last?.text).toContain('zet de drie pakketten met prijs erin');
  });

  it('still suggests a break after every third legacy session of the day', async () => {
    const router = createAssistantRouter({ db: db(), claude: scriptedClaude([]), now: () => NOW });
    const offerte = await byTitle('Offerte bakkerij afmaken');
    const replies = [];
    for (let i = 0; i < 3; i++) replies.push(...(await tap(router, `sess:${offerte.id}:done`)));
    expect(replies.some((reply) => reply.text.includes('Tijd voor een pauze?'))).toBe(true);
  });

  it('splits a big task with Claude before the first block', async () => {
    const claude = scriptedClaude([
      { tools: [{ name: 'break_down', input: { steps: steps('Maak een lijst van de pagina\'s', 'Schrijf de homepage', 'Schrijf de contactpagina') } }] },
    ]);
    const router = createAssistantRouter({ db: db(), claude, now: () => NOW });
    const site = await byTitle('Openingstijden op de site bijwerken');
    await db().update(tasks).set({ estimatedMinutes: 120, title: 'Teksten nieuwe site' }).where(eq(tasks.id, site.id));

    const replies = await tap(router, `blk:t${site.id}:m15`);
    expect(replies[0]?.text).toContain('Zo knippen we teksten nieuwe site op:');
    expect(replies[1]?.text).toBe("Top. 15 minuten voor teksten nieuwe site. Ik meld me aan het eind.\nEerste stap: maak een lijst van de pagina's.");
    expect(await childrenOf(site.id)).toHaveLength(3);
  });
});
