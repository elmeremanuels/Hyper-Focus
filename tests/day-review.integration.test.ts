import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAssistantRouter } from '../src/conversation/assistant.js';
import { planBlockMinutes } from '../src/conversation/blocks.js';
import { energyWeekLine } from '../src/conversation/day-review.js';
import { getState } from '../src/conversation/state.js';
import { createDbMessageStore } from '../src/core/messages.js';
import { createDbUserStore } from '../src/core/users.js';
import { dailyFocus, dayReviews, focusBlocks, tasks, userSettings, users } from '../src/db/schema/index.js';
import { runPlanner } from '../src/proactive/planner.js';
import { sendDueNudges } from '../src/proactive/sender.js';
import { scriptedClaude } from './helpers/claude.js';
import { fakeDelivery } from './helpers/delivery.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

describe.skipIf(!adminUrl)('day review (integration)', () => {
  const t = useTestDatabase();
  const db = () => t.connection.db;
  // These tests run through weekends: every day is a work day here (the work week has its own tests).
  beforeAll(async () => {
    await db().update(userSettings).set({ workDays: [1, 2, 3, 4, 5, 6, 7] }).where(eq(userSettings.userId, t.userId));
  });
  // Amsterdam is UTC+2 in October: planning at 22:05 UTC is 00:05 local the next day.
  const plan = (day: string) => runPlanner(db(), new Date(`${day}T22:05:00Z`));
  let kit: ReturnType<typeof fakeDelivery> | undefined;
  const delivery = () => (kit ??= fakeDelivery(createDbMessageStore(db())));
  const send = (at: string) => sendDueNudges({ db: db(), delivery: delivery().delivery, users: createDbUserStore(db()) }, new Date(at));
  const lastSent = () => delivery().telegram.sent().at(-1)?.body;
  const router = (at: string, claude = scriptedClaude([])) => createAssistantRouter({ db: db(), claude, now: () => new Date(at) });
  const tap = (at: string, buttonId: string) => router(at)({ kind: 'button', userId: t.userId, buttonId, title: buttonId });
  const id = async (title: string) => (await db().select().from(tasks).where(eq(tasks.title, title)))[0]!;
  const focusTitles = async (date: string) => {
    const [row] = await db().select().from(dailyFocus).where(and(eq(dailyFocus.userId, t.userId), eq(dailyFocus.localDate, date)));
    const rows = await db().select().from(tasks);
    return (row?.taskIds ?? []).map((taskId) => rows.find((task) => task.id === taskId)!);
  };
  const review = async (date: string) =>
    (await db().select().from(dayReviews).where(and(eq(dayReviews.userId, t.userId), eq(dayReviews.date, date))))[0];

  it('asks per open task, then the energy, then what is stuck, and closes', async () => {
    await db().update(users).set({ telegramChatId: 777 }).where(eq(users.id, t.userId));
    await plan('2026-10-06');
    expect((await focusTitles('2026-10-07')).map((task) => task.title)).toEqual([
      'Offerte bakkerij afmaken',
      'Factuur september versturen',
      'Banner voor de feestdagen',
    ]);

    await send('2026-10-07T14:00:10Z');
    expect(lastSent()?.text).toBe('Tijd om de dag af te ronden. Wat doen we met offerte bakkerij afmaken?');
    expect(JSON.stringify(lastSent()?.reply_markup)).toMatch(/Morgen.*Opknippen.*Parkeren.*Klaar.*Alles morgen/);
    expect(lastSent()?.disable_notification).toBeUndefined();

    const offerte = await id('Offerte bakkerij afmaken');
    const factuur = await id('Factuur september versturen');
    const [second] = await tap('2026-10-07T14:01:00Z', `dr:${offerte.id}:tomorrow`);
    expect(second?.text).toBe('Wat doen we met factuur september versturen?');
    expect((await id('Offerte bakkerij afmaken')).deferredCount).toBe(1);

    const [third] = await tap('2026-10-07T14:01:10Z', `dr:${factuur.id}:done`);
    expect(third?.text).toBe('Wat doen we met banner voor de feestdagen?');
    expect(third?.buttons?.map((b) => b.title)).not.toContain('Alles morgen');
    expect((await id('Factuur september versturen')).status).toBe('done');

    const banner = await id('Banner voor de feestdagen');
    const [energy] = await tap('2026-10-07T14:01:20Z', `dr:${banner.id}:tomorrow`);
    expect(energy).toMatchObject({ text: 'Hoe was je energie vandaag?' });
    expect(energy?.buttons?.map((b) => b.title)).toEqual(['Laag', 'Gewoon', 'Hoog']);

    const [stuck] = await tap('2026-10-07T14:01:30Z', 'dr:e:low');
    expect(stuck).toEqual({ text: 'Zit er morgen iets vast? Typ of spreek het in.', buttons: [{ id: 'dr:close', title: 'Nee, klaar' }] });
    expect(await review('2026-10-07')).toMatchObject({ energy: 'low', skipped: false });

    const [closing] = await router('2026-10-07T14:02:00Z')({ kind: 'text', userId: t.userId, text: 'nee' });
    expect(closing?.text).toBe('Dank je. Morgen om 08:30 staat je focus klaar.');
    expect((await getState(db(), t.userId, new Date('2026-10-07T14:02:00Z'))).mode).toBe('idle');
  });

  it('gives two tasks with a quick win and blocks of 15 the morning after low energy', async () => {
    await plan('2026-10-07');
    const focus = await focusTitles('2026-10-08');
    expect(focus).toHaveLength(2);
    expect(focus.some((task) => (task.estimatedMinutes ?? 0) >= 5 && (task.estimatedMinutes ?? 99) <= 15)).toBe(true);
    const ctx = { db: db(), userId: t.userId, timezone: 'Europe/Amsterdam', now: new Date('2026-10-08T08:00:00Z') };
    expect(await planBlockMinutes(ctx)).toBe(15);
  });

  it('routes a typed answer to the last question and closes with the blocks of today', async () => {
    await db()
      .insert(focusBlocks)
      .values({ userId: t.userId, plannedMinutes: 25, startedAt: new Date('2026-10-08T08:00:00Z'), endsAt: new Date('2026-10-08T08:25:00Z'), endedAt: new Date('2026-10-08T08:25:00Z'), outcome: 'completed' });
    await send('2026-10-08T14:00:10Z');
    expect(lastSent()?.text).toMatch(/^Tijd om de dag af te ronden\. Wat doen we met /);
    await tap('2026-10-08T14:01:00Z', 'dr:rest');
    await tap('2026-10-08T14:01:10Z', 'dr:e:high');

    const claude = scriptedClaude([{ tools: [{ name: 'add_task', input: { title: 'Wachtwoord hosting opvragen', estimated_minutes: 5 } }] }, { text: 'Staat erop.' }]);
    const replies = await router('2026-10-08T14:02:00Z', claude)({ kind: 'text', userId: t.userId, text: 'ik heb het wachtwoord van de hosting nodig' });
    expect(await id('Wachtwoord hosting opvragen')).toBeDefined();
    expect(replies.at(-1)?.text).toBe('Dank je. Vandaag 1 blok afgerond. Morgen om 08:30 staat je focus klaar.');
    expect(await review('2026-10-08')).toMatchObject({ energy: 'high' });
  });

  it('after high energy: blocks of 25, unless 2 of the last 3 pauses ended late', async () => {
    await plan('2026-10-08');
    const ctx = { db: db(), userId: t.userId, timezone: 'Europe/Amsterdam', now: new Date('2026-10-09T08:00:00Z') };
    expect(await planBlockMinutes(ctx)).toBe(25);
    expect(await focusTitles('2026-10-09')).toHaveLength(3);

    const pause = (due: string, returned: string | null) => ({
      userId: t.userId,
      plannedMinutes: 15,
      startedAt: new Date(new Date(due).getTime() - 20 * 60_000),
      endsAt: new Date(due),
      endedAt: new Date(due),
      outcome: 'completed' as const,
      pauseStartedAt: new Date(new Date(due).getTime() - 2 * 60_000),
      pauseDueAt: new Date(due),
      returnedAt: returned ? new Date(returned) : null,
    });
    await db().insert(focusBlocks).values([
      pause('2026-10-08T09:00:00Z', '2026-10-08T09:10:00Z'),
      pause('2026-10-08T10:00:00Z', '2026-10-08T09:59:00Z'),
      pause('2026-10-08T11:00:00Z', null),
    ]);
    expect(await planBlockMinutes(ctx)).toBe(15);
    await db().delete(focusBlocks);
  });

  it('closes a skipped review silently and never mentions it', async () => {
    // The review of 9 October was never answered.
    await send('2026-10-09T14:00:10Z');
    expect(await review('2026-10-09')).toMatchObject({ completedAt: null, skipped: false });
    expect((await getState(db(), t.userId, new Date('2026-10-09T22:01:00Z'))).mode).toBe('idle');

    // Planning the next day marks it skipped.
    await plan('2026-10-09');
    expect(await review('2026-10-09')).toMatchObject({ skipped: true });
    const before = delivery().telegram.sent().length;
    await send('2026-10-10T06:30:10Z');
    const texts = delivery().telegram.sent().slice(before).map((call) => String(call.body.text));
    expect(texts.join(' ')).not.toMatch(/review|afgerond|gisteren|overgeslagen/i);
  });

  it('proposes to split or park a task that moved to tomorrow three times', async () => {
    const offerte = await id('Offerte bakkerij afmaken');
    await db().update(tasks).set({ deferredCount: 3 }).where(eq(tasks.id, offerte.id));
    // Factuur via the router: snooze counts as a move to tomorrow.
    const banner = await id('Banner voor de feestdagen');
    const claude = scriptedClaude([{ tools: [{ name: 'snooze', input: { task_id: banner.id, until_date: '2026-10-11' } }] }, { text: 'Prima.' }]);
    await router('2026-10-10T09:00:00Z', claude)({ kind: 'text', userId: t.userId, text: 'zet de banner op morgen' });
    expect((await id('Banner voor de feestdagen')).deferredCount).toBe(banner.deferredCount + 1);

    await plan('2026-10-10');
    expect((await focusTitles('2026-10-11')).map((task) => task.id)).toContain(offerte.id);
    const before = delivery().telegram.sent().length;
    await send('2026-10-11T06:30:10Z');
    const sent = delivery().telegram.sent().slice(before).map((call) => call.body);
    expect(sent[0]?.text).toMatch(/^Goedemorgen\. /);
    expect(sent[1]?.text).toBe('Offerte bakkerij afmaken: Deze schuift al een paar dagen door. Zullen we hem opknippen of parkeren?');
    expect(JSON.stringify(sent[1]?.reply_markup)).toContain(`df:${offerte.id}:keep`);

    const [kept] = await tap('2026-10-11T06:31:00Z', `df:${offerte.id}:keep`);
    expect(kept?.text).toBe('Prima, hij blijft staan.');
    expect((await id('Offerte bakkerij afmaken')).deferredCount).toBe(0);
  });

  it('puts yesterday\'s hyperfocus task on top', async () => {
    const banner = await id('Banner voor de feestdagen');
    await db().insert(focusBlocks).values({
      userId: t.userId,
      taskId: banner.id,
      plannedMinutes: 45,
      extendedMinutes: 15,
      startedAt: new Date('2026-10-11T08:00:00Z'),
      endsAt: new Date('2026-10-11T09:00:00Z'),
      endedAt: new Date('2026-10-11T09:00:00Z'),
      outcome: 'extended',
    });
    await db().update(tasks).set({ snoozedUntil: null, status: 'open' }).where(eq(tasks.id, banner.id));
    await plan('2026-10-11');
    expect((await focusTitles('2026-10-12'))[0]?.id).toBe(banner.id);
  });

  it('saves the energy from the router and sums up the week', async () => {
    const claude = scriptedClaude([{ tools: [{ name: 'set_day_energy', input: { energy: 'low' } }] }]);
    const [reply] = await router('2026-10-12T15:00:00Z', claude)({ kind: 'text', userId: t.userId, text: 'energie was vandaag laag' });
    expect(reply?.text).toBe('Genoteerd. Morgen houd ik daar rekening mee.');
    expect(await review('2026-10-12')).toMatchObject({ energy: 'low' });
    expect(await energyWeekLine(db(), t.userId, '2026-10-06')).toBe('Deze week: 2× laag, 1× hoog.');
  });
});
