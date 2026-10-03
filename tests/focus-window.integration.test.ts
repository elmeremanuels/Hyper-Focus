import { and, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAssistantRouter } from '../src/conversation/assistant.js';
import { clearState } from '../src/conversation/state.js';
import { createDbMessageStore } from '../src/core/messages.js';
import { createDbUserStore } from '../src/core/users.js';
import {
  calendarEvents,
  calendarConnections,
  dailyFocus,
  events,
  focusBlocks,
  focusWindows,
  rhythmProfiles,
  scheduledNudges,
  tasks,
  userSettings,
  users,
} from '../src/db/schema/index.js';
import { saveUserTool } from '../src/core/user-tools.js';
import { computeRhythm, learnRhythm, rhythmProposal } from '../src/focus/windows.js';
import { runPlanner } from '../src/proactive/planner.js';
import { blocksScenario, rhythmScenario } from '../src/proactive/sim-scenarios.js';
import { simulateDays } from '../src/proactive/simulate.js';
import { sendDueNudges } from '../src/proactive/sender.js';
import { scriptedClaude } from './helpers/claude.js';
import { fakeDelivery } from './helpers/delivery.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

// Amsterdam is UTC+2 in October. The standard window is 10:30–12:00 local, 08:30–10:00 UTC.
const at = (day: string, time: string) => new Date(`${day}T${time}Z`);

describe.skipIf(!adminUrl)('focus window (integration)', () => {
  const t = useTestDatabase();
  const db = () => t.connection.db;
  // These tests run through weekends: every day is a work day here (the work week has its own tests).
  beforeAll(async () => {
    await db().update(userSettings).set({ workDays: [1, 2, 3, 4, 5, 6, 7] }).where(eq(userSettings.userId, t.userId));
  });
  let kit: ReturnType<typeof fakeDelivery> | undefined;
  const delivery = () => (kit ??= fakeDelivery(createDbMessageStore(db())));
  const send = (when: Date) => sendDueNudges({ db: db(), delivery: delivery().delivery, users: createDbUserStore(db()) }, when);
  const lastSent = () => delivery().telegram.sent().at(-1)?.body;
  const router = (now: Date, claude = scriptedClaude([])) => createAssistantRouter({ db: db(), claude, now: () => now });
  const tap = (now: Date, buttonId: string) => router(now)({ kind: 'button', userId: t.userId, buttonId, title: buttonId });
  const say = (now: Date, text: string, claude = scriptedClaude([])) => router(now, claude)({ kind: 'text', userId: t.userId, text });
  const plan = (day: string) => runPlanner(db(), at(day, '22:05:00'));
  const window = async (date: string) =>
    (await db().select().from(focusWindows).where(and(eq(focusWindows.userId, t.userId), eq(focusWindows.date, date)))).filter((w) => w.status !== 'moved')[0];
  const nudges = async (kind: string) =>
    db()
      .select()
      .from(scheduledNudges)
      .where(and(eq(scheduledNudges.userId, t.userId), eq(scheduledNudges.kind, kind as 'window_missed')));
  const offerte = async () => (await db().select().from(tasks).where(eq(tasks.title, 'Offerte bakkerij afmaken')))[0]!;

  beforeEach(async () => {
    await db().update(users).set({ telegramChatId: 777 }).where(eq(users.id, t.userId));
    await clearState(db(), t.userId);
  });

  it('asks once when the user works best, and the answer sets the window from tomorrow', async () => {
    const [question] = await tap(at('2026-10-06', '07:00:00'), 'fp:ask');
    expect(question).toEqual({
      text: 'Wanneer werk je meestal het best?',
      buttons: [
        { id: 'fp:morning', title: 'Ochtend' },
        { id: 'fp:afternoon', title: 'Middag' },
        { id: 'fp:evening', title: 'Avond' },
        { id: 'fp:unknown', title: 'Weet ik niet' },
      ],
    });
    const [saved] = await tap(at('2026-10-06', '07:00:10'), 'fp:afternoon');
    expect(saved?.text).toBe('Genoteerd. Vanaf morgen staat je focusvenster op 13:30–15:00.');
    expect((await say(at('2026-10-06', '07:01:00'), 'mijn ritme'))[0]?.text).toBe('Wanneer werk je meestal het best?');

    await plan('2026-10-06');
    const w = await window('2026-10-07');
    expect(w).toMatchObject({ source: 'pref', startsAt: at('2026-10-07', '11:30:00'), endsAt: at('2026-10-07', '13:00:00') });
    expect(w?.taskId).toBe((await offerte()).id);
    // Back to the standard window for the other tests.
    await tap(at('2026-10-06', '07:02:00'), 'fp:unknown');
  });

  it('names the window in the morning, sends the heads-up with the workplace button, and lists the window task last', async () => {
    await db().update(tasks).set({ workType: 'invoicing' }).where(eq(tasks.id, (await offerte()).id));
    await saveUserTool(db(), t.userId, { workType: 'invoicing', toolKey: 'moneybird', label: 'Moneybird', url: 'https://moneybird.com/login' });
    await plan('2026-10-07');
    await send(at('2026-10-08', '06:30:10'));
    const morning = delivery().telegram.sent().find((c) => String(c.body.text).startsWith('Goedemorgen'))?.body;
    expect(String(morning?.text)).toContain('Je focusvenster vandaag: 10:30–12:00. Daar zet ik offerte bakkerij afmaken.');
    expect(JSON.stringify(morning?.reply_markup)).toContain('Schuif venster');

    await send(at('2026-10-08', '08:15:10'));
    expect(lastSent()?.text).toBe('Over een kwartier je focusvenster. Offerte bakkerij afmaken ligt klaar.');
    const markup = JSON.stringify(lastSent()?.reply_markup);
    expect(markup).toContain('Start om 10:30');
    expect(markup).toContain('Open Moneybird');

    const [view] = await tap(at('2026-10-08', '08:16:00'), 'f:show');
    expect(view?.text.split('\n').filter((l) => /^\d\./.test(l)).at(-1)).toBe('3. Offerte bakkerij afmaken · focusvenster 10:30–12:00');
  });

  it('runs a window block of 60 minutes: one silent message after 50, then nothing until the end', async () => {
    const w = (await window('2026-10-08'))!;
    const [ask] = await tap(at('2026-10-08', '08:20:00'), `fw:${w.id}:start`);
    expect(ask?.text).toBe('Hoe lang ga je diep op offerte bakkerij afmaken?');
    expect(ask?.buttons?.map((b) => b.title)).toEqual(['45 min', '60 min', '90 min']);

    const task = await offerte();
    await tap(at('2026-10-08', '08:30:00'), `blk:t${task.id}:m60`);
    const [block] = await db().select().from(focusBlocks).where(eq(focusBlocks.userId, t.userId));
    expect(block).toMatchObject({ inWindow: true, plannedMinutes: 60 });
    expect(await window('2026-10-08')).toMatchObject({ status: 'used', startedBlockId: block!.id });

    const before = delivery().telegram.sent().length;
    for (const minute of ['08:45', '09:00', '09:15']) await send(at('2026-10-08', `${minute}:10`));
    expect(delivery().telegram.sent()).toHaveLength(before); // the missed check stays silent: the window is used
    await send(at('2026-10-08', '09:20:10'));
    expect(lastSent()).toMatchObject({ text: 'Goed bezig. Ik laat je. Ik meld me om 11:30.', disable_notification: true });
    await send(at('2026-10-08', '09:25:10'));
    expect(delivery().telegram.sent()).toHaveLength(before + 1);

    await send(at('2026-10-08', '09:30:10'));
    expect(lastSent()?.text).toBe('60 minuten diep werk. Hoe staat offerte bakkerij afmaken ervoor?');
    expect(JSON.stringify(lastSent()?.reply_markup)).toMatch(/"Af".*"Nog 30 min".*"Stoppen"/);
    expect(lastSent()?.disable_notification).toBeUndefined();

    // In a window the hyperfocus catcher waits for 90 minutes: 60 + 30 gives the pause message.
    await tap(at('2026-10-08', '09:31:00'), `blk:${block!.id}:plus30`);
    await send(at('2026-10-08', '10:01:10'));
    expect(lastSent()?.text).toBe('91 minuten diep werk. Tijd voor een pitstop.');
    await tap(at('2026-10-08', '10:02:00'), `blk:${block!.id}:stop`);
  });

  it('sends exactly one silent message for a missed window, then nothing', async () => {
    await plan('2026-10-08');
    await send(at('2026-10-09', '06:30:10'));
    await send(at('2026-10-09', '08:15:10'));
    await send(at('2026-10-09', '09:00:10'));
    const missedMessage = delivery().telegram.sent().find((c) => String(c.body.text).startsWith('Venster liep anders'))?.body;
    expect(missedMessage).toMatchObject({
      text: 'Venster liep anders. Zal ik offerte bakkerij afmaken naar vandaag 11:30 zetten?',
      disable_notification: true,
    });
    expect(await window('2026-10-09')).toMatchObject({ status: 'missed' });

    const w = (await window('2026-10-09'))!;
    const [moved] = await tap(at('2026-10-09', '09:01:00'), `fw:${w.id}:yes:t1130`);
    expect(moved?.text).toBe('Gezet. Offerte bakkerij afmaken: vandaag 11:30.');
    const now = (await window('2026-10-09'))!;
    expect(now).toMatchObject({ source: 'manual', status: 'planned', startsAt: at('2026-10-09', '09:30:00') });
    // A new heads-up, no second missed message.
    const missed = (await nudges('window_missed')).filter((n) => n.payload.windowId === now.id);
    expect(missed).toHaveLength(0);
    const before = delivery().telegram.sent().length;
    await send(at('2026-10-09', '09:15:10'));
    expect(lastSent()?.text).toBe('Over een kwartier je focusvenster. Offerte bakkerij afmaken ligt klaar.');
    await send(at('2026-10-09', '10:30:10'));
    expect(delivery().telegram.sent()).toHaveLength(before + 1);
  });

  it('moves the window by message: today at a time, or tomorrow at the own time with the task', async () => {
    const claude = scriptedClaude([{ tools: [{ name: 'move_focus_window', input: { date: '2026-10-09', time: '14:00' } }] }]);
    expect((await say(at('2026-10-09', '10:00:00'), 'focus vandaag om 14:00', claude))[0]?.text).toBe('Venster staat op vandaag 14:00–15:30.');
    expect((await window('2026-10-09'))?.startsAt).toEqual(at('2026-10-09', '12:00:00'));

    const tomorrow = scriptedClaude([{ tools: [{ name: 'move_focus_window', input: { date: '2026-10-10' } }] }]);
    expect((await say(at('2026-10-09', '10:01:00'), 'schuif mijn focusvenster naar morgen', tomorrow))[0]?.text).toBe(
      'Venster staat op morgen 10:30–12:00.',
    );
    await plan('2026-10-09');
    const w = await window('2026-10-10');
    expect(w).toMatchObject({ source: 'manual', startsAt: at('2026-10-10', '08:30:00') });
    const [focus] = await db().select().from(dailyFocus).where(and(eq(dailyFocus.userId, t.userId), eq(dailyFocus.localDate, '2026-10-10')));
    expect(focus?.taskIds[0]).toBe(w?.taskId);
  });

  it('gives a soft landing 10 minutes before an appointment in the window, and shows the sentence at the next start', async () => {
    await db().update(userSettings).set({ calendarEnabled: true }).where(eq(userSettings.userId, t.userId));
    const [connection] = await db()
      .insert(calendarConnections)
      .values({ userId: t.userId, provider: 'ics' })
      .returning();
    await db().insert(calendarEvents).values({
      userId: t.userId,
      connectionId: connection!.id,
      externalId: 'call',
      title: 'Bel met Boho',
      startsAtUtc: at('2026-10-11', '09:30:00'),
      endsAtUtc: at('2026-10-11', '10:00:00'),
    });
    await plan('2026-10-10');
    const landing = (await nudges('soft_landing')).find((n) => n.payload.localDate === '2026-10-11');
    expect(landing?.scheduledForUtc).toEqual(at('2026-10-11', '09:20:00'));

    const task = await offerte();
    await tap(at('2026-10-11', '08:30:00'), `blk:t${task.id}:m60`);
    await send(at('2026-10-11', '09:20:10'));
    const landingMessage = delivery().telegram.sent().find((c) => String(c.body.text).startsWith('Over 10 minuten'))?.body;
    expect(landingMessage).toMatchObject({ text: 'Over 10 minuten Bel met Boho. Schrijf in één zin op waar je bent.' });
    expect(landingMessage?.disable_notification).toBeUndefined();
    const [saved] = await say(at('2026-10-11', '09:21:00'), 'pakket twee staat, prijs van pakket drie nog checken');
    expect(saved?.text).toBe('Staat genoteerd. Je ziet het bij de volgende start.');
    expect((await offerte()).notes).toContain('Waar je was: pakket twee staat, prijs van pakket drie nog checken');

    const [next] = await tap(at('2026-10-11', '11:00:00'), `blk:t${task.id}:m45`);
    expect(next?.text).toContain('Waar je was: pakket twee staat, prijs van pakket drie nog checken');
    await tap(at('2026-10-11', '11:01:00'), `blk:${(await db().select().from(focusBlocks).where(eq(focusBlocks.userId, t.userId))).at(-1)!.id}:stop`);
  });

  it('lets quiet hours win over the soft landing', async () => {
    await db().update(userSettings).set({ quietStart: '11:00', quietEnd: '23:59' }).where(eq(userSettings.userId, t.userId));
    await db().insert(scheduledNudges).values({ userId: t.userId, kind: 'soft_landing', scheduledForUtc: at('2026-10-11', '10:00:00'), payload: { windowId: 1 } });
    await send(at('2026-10-11', '10:00:10'));
    const [skipped] = (await nudges('soft_landing')).filter((n) => n.scheduledForUtc.getTime() === at('2026-10-11', '10:00:00').getTime());
    expect(skipped).toMatchObject({ status: 'skipped', skipReason: 'quiet_hours' });
    await db().update(userSettings).set({ quietStart: '21:00', quietEnd: '08:00', calendarEnabled: false }).where(eq(userSettings.userId, t.userId));
  });

  it('learns the rhythm, proposes it once after the weekly review, and uses it after a yes', { timeout: 60_000 }, async () => {
    await db().delete(focusBlocks);
    // The rhythm counts work days: back to Monday to Friday.
    await db().update(userSettings).set({ workDays: [1, 2, 3, 4, 5] }).where(eq(userSettings.userId, t.userId));
    const { sent } = await simulateDays({ db: db(), userId: t.userId, start: '2026-10-12', days: 14, silent: false, actions: rhythmScenario(14) });
    const proposals = sent.filter((m) => m.text.startsWith('Je beste uren'));
    expect(proposals.map((m) => m.text)).toEqual(['Je beste uren liggen op werkdagen rond 13:30. Zal ik je focusvenster daar zetten?']);

    // Outside the simulation: the same data, stored.
    await db().update(users).set({ telegramChatId: 777 }).where(eq(users.id, t.userId));
    const blocks = [];
    for (let d = 0; d < 14; d++) {
      const date = new Date(Date.parse('2026-10-12T00:00:00Z') + d * 86_400_000);
      if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
      const day = date.toISOString().slice(0, 10);
      blocks.push(
        { userId: t.userId, plannedMinutes: 45, startedAt: at(day, '11:30:00'), endsAt: at(day, '12:15:00'), endedAt: at(day, '12:15:00'), outcome: 'completed' as const },
        { userId: t.userId, plannedMinutes: 45, startedAt: at(day, '12:20:00'), endsAt: at(day, '13:05:00'), endedAt: at(day, '13:05:00'), outcome: 'completed' as const },
      );
    }
    await db().insert(focusBlocks).values(blocks);
    const result = await computeRhythm(db(), t.userId, 'Europe/Amsterdam', at('2026-10-25', '20:00:00'));
    expect(result.eligible).toBe(true);
    expect(result.windows.find((w) => w.weekday === 3)?.start).toBe('13:30');

    const proposal = await rhythmProposal(db(), t.userId, 'Europe/Amsterdam', at('2026-10-25', '20:00:00'));
    expect(proposal).toEqual({ start: '13:30', weekdays: [1, 2, 3, 4, 5] });
    const [yes] = await tap(at('2026-10-25', '18:00:00'), 'rh:yes:1330:12345');
    expect(yes?.text).toBe('Gedaan. Je focusvenster volgt nu je beste uren.');
    expect(await rhythmProposal(db(), t.userId, 'Europe/Amsterdam', at('2026-10-25', '20:01:00'))).toBeUndefined();

    await runPlanner(db(), at('2026-10-25', '23:05:00')); // 00:05 on Monday 26 October (winter time)
    expect(await window('2026-10-26')).toMatchObject({ source: 'learned', startsAt: at('2026-10-26', '12:30:00') });
  });

  it('moves a learned window at most 30 minutes a week; a bigger jump is asked first', async () => {
    await db().update(rhythmProfiles).set({ computedAt: at('2026-10-01', '00:00:00'), windowStart: '10:00' }).where(eq(rhythmProfiles.userId, t.userId));
    await learnRhythm(db(), t.userId, 'Europe/Amsterdam', at('2026-10-26', '00:10:00'));
    const [monday] = await db().select().from(rhythmProfiles).where(and(eq(rhythmProfiles.userId, t.userId), eq(rhythmProfiles.weekday, 1)));
    expect(monday?.windowStart.slice(0, 5)).toBe('10:00');
    const pending = await db().select().from(events).where(and(eq(events.userId, t.userId), eq(events.name, 'rhythm_proposed')));
    expect(pending.some((e) => e.props.pending === true && e.props.start === '13:30')).toBe(true);
    expect((await rhythmProposal(db(), t.userId, 'Europe/Amsterdam', at('2026-10-26', '19:00:00')))?.start).toBe('13:30');
  });

  it('keeps the blocks scenario outside the window', async () => {
    const { sent } = await simulateDays({ db: db(), userId: t.userId, start: '2026-11-04', days: 1, silent: false, actions: blocksScenario(0) });
    expect(sent.some((m) => m.text.startsWith('25 minuten voor'))).toBe(true);
  });

  it('removes windows and rhythm with the user', async () => {
    await db().delete(users).where(eq(users.id, t.userId));
    expect(await db().select().from(focusWindows)).toHaveLength(0);
    expect(await db().select().from(rhythmProfiles)).toHaveLength(0);
  });
});
