import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { handleButton } from '../src/conversation/buttons.js';
import { createDbMessageStore } from '../src/core/messages.js';
import { setPausedUntil } from '../src/core/settings.js';
import { createDbUserStore } from '../src/core/users.js';
import { dailyFocus, scheduledNudges, tasks, users } from '../src/db/schema/index.js';
import example from '../src/db/seed/example.js';
import { loadSeed } from '../src/db/seed/load.js';
import { planDay, runPlanner } from '../src/proactive/planner.js';
import { sendDueNudges } from '../src/proactive/sender.js';
import { fakeDelivery } from './helpers/delivery.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

describe.skipIf(!adminUrl)('daily rhythm (integration)', () => {
  const t = useTestDatabase();
  const db = () => t.connection.db;
  const nudgesFor = async (userId: number, localDate: string) =>
    (await db().select().from(scheduledNudges).where(eq(scheduledNudges.userId, userId)))
      .filter((nudge) => nudge.payload.localDate === localDate)
      .sort((a, b) => a.scheduledForUtc.getTime() - b.scheduledForUtc.getTime())
      .map((nudge) => ({ kind: nudge.kind, at: nudge.scheduledForUtc.toISOString(), status: nudge.status, reason: nudge.skipReason }));
  const title = async (id: number) => (await db().select().from(tasks).where(eq(tasks.id, id)))[0]?.title;

  it('plans at 00:05 local time, once', async () => {
    const early = await runPlanner(db(), new Date('2026-10-06T22:04:00Z')); // 00:04 in Amsterdam
    expect(early.filter((plan) => plan.userId === t.userId && plan.localDate === '2026-10-07')).toHaveLength(0);

    const plans = await runPlanner(db(), new Date('2026-10-06T22:05:00Z'));
    expect(plans.find((plan) => plan.userId === t.userId)?.localDate).toBe('2026-10-07');
    await runPlanner(db(), new Date('2026-10-06T22:30:00Z'));

    expect(await nudgesFor(t.userId, '2026-10-07')).toEqual([
      { kind: 'morning', at: '2026-10-07T06:30:00.000Z', status: 'pending', reason: null },
      { kind: 'midday', at: '2026-10-07T11:30:00.000Z', status: 'pending', reason: null },
      { kind: 'wrapup', at: '2026-10-07T14:00:00.000Z', status: 'pending', reason: null },
    ]);
  });

  it('builds a focus of at most three tasks with one quick win', async () => {
    const [focus] = await db()
      .select()
      .from(dailyFocus)
      .where(and(eq(dailyFocus.userId, t.userId), eq(dailyFocus.localDate, '2026-10-07')));
    expect(focus?.taskIds.length).toBeLessThanOrEqual(3);
    expect(await Promise.all(focus!.taskIds.map(title))).toEqual([
      'Offerte bakkerij afmaken',
      'Factuur september versturen',
      'Banner voor de feestdagen',
    ]);
    expect(await title(focus!.quickWinTaskId!)).toBe('Factuur september versturen');
  });

  it('plans in local time for Bali, across the Dutch clock change and after a move', async () => {
    const bali = (
      await loadSeed(db(), { ...example, user: { ...example.user, email: 'bali@voorbeeld.invalid', timezone: 'Asia/Makassar' } })
    ).userId;
    await planDay(db(), bali, 'Asia/Makassar', new Date('2026-10-06T16:06:00Z')); // 00:06 on 7 Oct in Bali
    expect((await nudgesFor(bali, '2026-10-07'))[0]).toMatchObject({ kind: 'morning', at: '2026-10-07T00:30:00.000Z' });

    // Winter time in Amsterdam from 25 October: 08:30 is 07:30 UTC.
    await planDay(db(), t.userId, 'Europe/Amsterdam', new Date('2026-10-25T23:10:00Z'));
    const monday = await nudgesFor(t.userId, '2026-10-26');
    expect(monday.find((n) => n.kind === 'morning')).toMatchObject({ at: '2026-10-26T07:30:00.000Z' });
    expect(monday.find((n) => n.kind === 'weekly_review')).toMatchObject({ at: '2026-10-26T07:00:00.000Z' });

    // The Bali user moves to the Netherlands: the next day follows the new timezone.
    await db().update(users).set({ timezone: 'Europe/Amsterdam' }).where(eq(users.id, bali));
    await runPlanner(db(), new Date('2026-10-07T22:06:00Z'));
    expect((await nudgesFor(bali, '2026-10-08'))[0]).toMatchObject({ kind: 'morning', at: '2026-10-08T06:30:00.000Z' });
  });

  it('sends the morning by Telegram, skips midday once started, and falls back to mail', async () => {
    await db().update(users).set({ telegramChatId: 4242 }).where(eq(users.id, t.userId));
    const { delivery, telegram, brevo } = fakeDelivery(createDbMessageStore(db()));
    const deps = { db: db(), delivery, users: createDbUserStore(db()), log: { error: () => undefined, warn: () => undefined } };

    // Only nudges due by then; the 26 October plan stays pending.
    const morning = await sendDueNudges(deps, new Date('2026-10-07T06:30:30Z'));
    expect(morning.sent).toBeGreaterThanOrEqual(1);
    const sam = telegram.sent().find((call) => call.body.chat_id === 4242);
    expect(sam?.body.text).toBe('Goedemorgen Sam. Je focus voor vandaag staat klaar.');

    // The main task (Offerte) is already in progress in the seed.
    await sendDueNudges(deps, new Date('2026-10-07T11:31:00Z'));
    telegram.failSendWith(403, 'Forbidden: bot was blocked by the user');
    await sendDueNudges(deps, new Date('2026-10-07T14:00:10Z'));

    const statuses = await nudgesFor(t.userId, '2026-10-07');
    expect(statuses.map((nudge) => [nudge.kind, nudge.status, nudge.reason])).toEqual([
      ['morning', 'sent', null],
      ['midday', 'skipped', 'main_task_started'],
      ['wrapup', 'sent', null],
    ]);
    const mail = brevo.sent.at(-1)?.body;
    expect(mail?.subject).toBe('De dag afronden');
    expect(mail?.textContent).toContain('Tijd om de dag af te ronden.');
    expect(mail?.textContent).toContain('Morgen verder');
  });

  it('skips messages during a pause and messages that are far too late', async () => {
    // Planned for 8 October by the tick at 00:06 local in the previous test.
    await setPausedUntil(db(), t.userId, new Date('2026-10-08T22:00:00Z'));
    const { delivery } = fakeDelivery(createDbMessageStore(db()));
    const deps = { db: db(), delivery, users: createDbUserStore(db()) };
    await sendDueNudges(deps, new Date('2026-10-08T06:31:00Z'));
    expect((await nudgesFor(t.userId, '2026-10-08'))[0]).toMatchObject({ kind: 'morning', status: 'skipped', reason: 'paused' });

    await setPausedUntil(db(), t.userId, null);
    await sendDueNudges(deps, new Date('2026-10-08T16:01:00Z')); // wrapup was at 14:00
    expect((await nudgesFor(t.userId, '2026-10-08')).at(-1)).toMatchObject({ kind: 'wrapup', status: 'skipped', reason: 'too_late' });
  });

  it('finishes the day with one tap', async () => {
    const ctx = { db: db(), userId: t.userId, timezone: 'Europe/Amsterdam', now: new Date('2026-10-07T14:05:00Z') };
    const [reply] = await handleButton('f:carry', ctx);
    expect(reply?.text).toBe('Staat klaar voor morgen. Fijne avond.');
    const [focus] = await db()
      .select()
      .from(dailyFocus)
      .where(and(eq(dailyFocus.userId, t.userId), eq(dailyFocus.localDate, '2026-10-07')));
    expect(focus?.wrapupDoneAt).not.toBeNull();
    const carried = await db().select().from(tasks).where(and(eq(tasks.userId, t.userId), eq(tasks.carryOver, true)));
    expect(carried.length).toBeGreaterThan(0);
  });
});
