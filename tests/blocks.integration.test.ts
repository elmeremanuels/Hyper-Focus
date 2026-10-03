import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { signInitData } from '../src/channels/telegram/webapp.js';
import { activeBlock, gardenGrowthSince, isFocusQuiet } from '../src/conversation/blocks.js';
import { createAssistantRouter } from '../src/conversation/assistant.js';
import { reviewStart } from '../src/conversation/review.js';
import { clearState, getState } from '../src/conversation/state.js';
import { createDbMessageStore } from '../src/core/messages.js';
import { createDbUserStore } from '../src/core/users.js';
import { focusBlocks, gardenEvents, scheduledNudges, tasks, userSettings, users } from '../src/db/schema/index.js';
import { sendDueNudges } from '../src/proactive/sender.js';
import { blocksScenario } from '../src/proactive/sim-scenarios.js';
import { simulateDays } from '../src/proactive/simulate.js';
import { focusStats } from '../src/stats/focus.js';
import { scriptedClaude } from './helpers/claude.js';
import { fakeDelivery } from './helpers/delivery.js';
import { startServer } from './helpers/server.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

const BOT_TOKEN = 'test-token';
const OWNER = 4242;
const at = (time: string) => new Date(`2026-10-07T${time}Z`);

describe.skipIf(!adminUrl)('work blocks, pauses and the reward minute (integration)', () => {
  const t = useTestDatabase();
  const db = () => t.connection.db;
  let deliveryKit: ReturnType<typeof fakeDelivery> | undefined;

  const router = (now: Date, claude = scriptedClaude([])) =>
    createAssistantRouter({ db: db(), claude, now: () => now, appBaseUrl: 'https://hyper-focus.invalid' });
  const tap = (now: Date, buttonId: string) => router(now)({ kind: 'button', userId: t.userId, buttonId, title: buttonId });
  const say = (now: Date, text: string, claude = scriptedClaude([])) => router(now, claude)({ kind: 'text', userId: t.userId, text });
  const send = (now: Date) => sendDueNudges({ db: db(), delivery: deliveryKit!.delivery, users: createDbUserStore(db()) }, now);
  const lastSent = () => deliveryKit!.telegram.sent().at(-1)?.body;
  const taskId = async (title: string) => (await db().select().from(tasks).where(eq(tasks.title, title)))[0]!.id;
  const garden = async () => (await db().select({ g: users.gardenGrowth }).from(users).where(eq(users.id, t.userId)))[0]!.g;
  const blockIdFrom = (body: Record<string, unknown> | undefined, action: string) =>
    Number(new RegExp(`blk:(\\d+):${action}`).exec(JSON.stringify(body?.reply_markup))?.[1]);
  const nudges = (kind: string) =>
    db()
      .select()
      .from(scheduledNudges)
      .where(and(eq(scheduledNudges.userId, t.userId), eq(scheduledNudges.kind, kind as 'block_end')));

  beforeEach(async () => {
    deliveryKit ??= fakeDelivery(createDbMessageStore(db()));
    await db().update(users).set({ telegramChatId: 777, telegramUserId: OWNER }).where(eq(users.id, t.userId));
    await db().delete(scheduledNudges);
    await clearState(db(), t.userId);
    await db().delete(gardenEvents);
    await db().delete(focusBlocks);
    await db().update(users).set({ gardenGrowth: 0 }).where(eq(users.id, t.userId));
    await db().update(userSettings).set({ rewardsEnabled: true }).where(eq(userSettings.userId, t.userId));
  });

  it('runs a block, a silent pause with a mission and an on-time return with an extra leaf', async () => {
    const banner = await taskId('Banner voor de feestdagen');
    await tap(at('08:30:00'), `blk:t${banner}:m15`);
    expect(await isFocusQuiet(db(), t.userId, at('08:31:00'))).toBe(true);

    // Other nudges wait while the block runs.
    await db().insert(scheduledNudges).values({ userId: t.userId, kind: 'midday', scheduledForUtc: at('08:40:00'), payload: { taskId: await taskId('Offerte bakkerij afmaken') } });
    expect(await send(at('08:40:30'))).toMatchObject({ sent: 0, postponed: 1 });

    // The block end makes a sound.
    expect((await send(at('08:45:10'))).sent).toBe(1);
    expect(lastSent()?.text).toBe('Je 15 minuten zitten erop. Hoe ging het?');
    expect(lastSent()?.disable_notification).toBeUndefined();
    const blockId = blockIdFrom(lastSent(), 'done');

    const [pause] = await tap(at('08:46:00'), `blk:${blockId}:done`);
    expect(pause?.text).toContain('Je telefoon blijft liggen.');
    expect(pause?.buttons?.[0]).toEqual({ id: `blk:${blockId}:back`, title: 'Ik ben terug' });
    expect(await garden()).toBe(1);
    expect((await activeBlock(db(), t.userId, at('08:47:00')))?.phase).toBe('pause');

    const [back] = await tap(at('08:47:30'), `blk:${blockId}:back`);
    expect(back?.text).toBe('Welkom terug. Je plant kreeg een extra druppel.');
    expect(back?.buttons?.map((b) => b.title)).toEqual(['Je minuut', 'Volgende blok starten']);
    expect(back?.buttons?.[0]?.webApp).toMatch(/^https:\/\/hyper-focus\.invalid\/app\/beloning\?t=[\w-]{20,}$/);
    expect(await garden()).toBe(2);
    expect((await nudges('return_reminder')).every((n) => n.status === 'skipped')).toBe(true);
    expect((await getState(db(), t.userId, at('08:48:00'))).mode).toBe('idle');
    expect(await isFocusQuiet(db(), t.userId, at('08:48:00'))).toBe(false);

    // After the pause the postponed midday nudge is handled as usual (here skipped: the task already started).
    expect(await send(at('08:51:00'))).toMatchObject({ postponed: 0, skipped: 1 });
    expect((await nudges('midday'))[0]).toMatchObject({ status: 'skipped', skipReason: 'main_task_started' });

    // The weekly review counts the leaves.
    expect(await gardenGrowthSince(db(), t.userId, at('00:00:00'))).toBe(2);
    expect((await reviewStart({ db: db(), userId: t.userId, now: at('09:00:00') })).text).toContain('Je tuin groeide deze week met 2 blaadjes.');
  });

  it('sends one return reminder with sound when the pause runs out, then closes the pause silently', async () => {
    const banner = await taskId('Banner voor de feestdagen');
    const [started] = await tap(at('09:00:00'), `blk:t${banner}:m25`);
    const blockId = Number(/blk:(\d+):stop/.exec(started!.buttons![0]!.id)?.[1]);
    await tap(at('09:10:00'), `blk:${blockId}:done`);
    const [block] = await db().select().from(focusBlocks).where(eq(focusBlocks.id, blockId));
    const due = block!.pauseDueAt!;

    expect((await send(new Date(due.getTime() + 30_000))).sent).toBe(1);
    expect(lastSent()?.text).toBe('Terug naar je blok?');
    expect(lastSent()?.disable_notification).toBeUndefined();
    expect((await send(new Date(due.getTime() + 5 * 60_000))).sent).toBe(0);

    // Late: a text counts as the button, without the extra leaf.
    const before = await garden();
    const [late] = await say(new Date(due.getTime() + 6 * 60_000), 'ben terug');
    expect(late?.text).toBe('Welkom terug.');
    expect(await garden()).toBe(before);
  });

  it('closes an unanswered pause after 30 minutes without a message', async () => {
    const banner = await taskId('Banner voor de feestdagen');
    const [started] = await tap(at('09:00:00'), `blk:t${banner}:m15`);
    const blockId = Number(/blk:(\d+):stop/.exec(started!.buttons![0]!.id)?.[1]);
    await tap(at('09:15:00'), `blk:${blockId}:done`);
    const due = (await db().select().from(focusBlocks).where(eq(focusBlocks.id, blockId)))[0]!.pauseDueAt!;
    await send(new Date(due.getTime() + 10_000));
    const count = deliveryKit!.telegram.sent().length;
    const after = new Date(due.getTime() + 31 * 60_000);
    await send(after);
    expect(deliveryKit!.telegram.sent()).toHaveLength(count);
    expect((await getState(db(), t.userId, after)).mode).toBe('idle');
    expect(await activeBlock(db(), t.userId, after)).toBeUndefined();
  });

  it('catches hyperfocus once after 60+ minutes, asks once more after "Nog 15 min", then lets go', async () => {
    const banner = await taskId('Banner voor de feestdagen');
    // 15 + 25 + 25 minutes without a return from the pauses.
    await tap(at('10:00:00'), `blk:t${banner}:m15`);
    await send(at('10:15:05'));
    await tap(at('10:15:10'), `blk:${blockIdFrom(lastSent(), 'done')}:done`);
    await tap(at('10:16:00'), `blk:t${banner}:m25`);
    await send(at('10:41:05'));
    expect(lastSent()?.text).toBe('Je 25 minuten zitten erop. Hoe ging het?');
    await tap(at('10:41:10'), `blk:${blockIdFrom(lastSent(), 'done')}:done`);
    await tap(at('10:42:00'), `blk:t${banner}:m25`);

    const before = deliveryKit!.telegram.sent().length;
    await send(at('11:07:05'));
    expect(deliveryKit!.telegram.sent()).toHaveLength(before + 1);
    expect(lastSent()?.text).toBe('Je bent al een uur bezig. Tijd voor water en even bewegen.');
    expect(JSON.stringify(lastSent()?.reply_markup)).toContain('Pauze nemen');
    expect(lastSent()?.disable_notification).toBeUndefined();
    const blockId = blockIdFrom(lastSent(), 'plus15');

    await tap(at('11:08:00'), `blk:${blockId}:plus15`);
    await send(at('11:23:05'));
    expect(lastSent()?.text).toBe('Je bent al een uur bezig. Tijd voor water en even bewegen.');
    expect(deliveryKit!.telegram.sent()).toHaveLength(before + 2);

    // Third time: no more insisting, only the normal question.
    await tap(at('11:24:00'), `blk:${blockId}:plus15`);
    await send(at('11:39:05'));
    expect(lastSent()?.text).toBe('Je 15 minuten zitten erop. Hoe ging het?');
    expect(deliveryKit!.telegram.sent()).toHaveLength(before + 3);
  });

  it('lets quiet hours and /pauze win over the block messages', async () => {
    const banner = await taskId('Banner voor de feestdagen');
    const [started] = await tap(at('09:00:00'), `blk:t${banner}:m15`);
    const blockId = Number(/blk:(\d+):stop/.exec(started!.buttons![0]!.id)?.[1]);
    await tap(at('09:05:00'), `blk:${blockId}:done`);
    // Quiet hours from 07:00 local (05:00 UTC) cover the reminder.
    await db().update(userSettings).set({ quietStart: '07:00', quietEnd: '23:00' }).where(eq(userSettings.userId, t.userId));
    expect(await send(at('09:09:00'))).toMatchObject({ sent: 0 });
    const [reminder] = await nudges('return_reminder');
    expect(reminder).toMatchObject({ status: 'skipped', skipReason: 'quiet_hours' });
    await db().update(userSettings).set({ quietStart: '21:00', quietEnd: '08:00' }).where(eq(userSettings.userId, t.userId));

    await tap(at('09:10:00'), `blk:t${banner}:m15`);
    await db().update(userSettings).set({ pausedUntil: at('23:00:00') }).where(eq(userSettings.userId, t.userId));
    expect(await send(at('09:25:05'))).toMatchObject({ sent: 0 });
    expect((await nudges('block_end')).at(-1)).toMatchObject({ status: 'skipped', skipReason: 'paused' });
    await db().update(userSettings).set({ pausedUntil: null }).where(eq(userSettings.userId, t.userId));
  });

  it('keeps blocks and pauses working with rewards off, without leaves or the reward minute', async () => {
    const [help] = await say(at('11:59:00'), 'help');
    expect(help?.buttons?.map((b) => b.title)).toContain('Beloningen uit');
    const [off] = await say(at('12:00:00'), 'zet beloningen uit');
    expect(off?.text).toBe('Beloningen staan uit. Je werkblokken en pauzes lopen gewoon door.');
    const banner = await taskId('Banner voor de feestdagen');
    const [started] = await tap(at('12:00:00'), `blk:t${banner}:m15`);
    const blockId = Number(/blk:(\d+):stop/.exec(started!.buttons![0]!.id)?.[1]);
    await tap(at('12:15:00'), `blk:${blockId}:done`);
    const [back] = await tap(at('12:16:00'), `blk:${blockId}:back`);
    expect(back?.text).toBe('Welkom terug.');
    expect(back?.buttons?.map((b) => b.title)).toEqual(['Volgende blok starten']);
    expect(await garden()).toBe(0);
    expect((await reviewStart({ db: db(), userId: t.userId, now: at('12:17:00') })).text).not.toContain('tuin');
    await clearState(db(), t.userId);
    const [helpOff] = await say(at('12:18:00'), 'help');
    expect(helpOff?.buttons?.map((b) => b.title)).toContain('Beloningen aan');
    const [on] = await say(at('12:20:00'), 'zet beloningen aan');
    expect(on?.text).toBe('Beloningen staan weer aan.');
  });

  it('rounds the minutes from the router to the nearest preset', async () => {
    const offerte = await taskId('Offerte bakkerij afmaken');
    const claude = scriptedClaude([{ tools: [{ name: 'start_session', input: { task_id: offerte, minutes: 40 } }] }, { text: 'Komt goed.' }]);
    const replies = await say(at('13:00:00'), 'even 40 min aan de offerte', claude);
    expect(replies[0]?.text).toContain('Top. 45 minuten voor offerte bakkerij afmaken.');
    const [block] = await db().select().from(focusBlocks).where(eq(focusBlocks.userId, t.userId));
    expect(block?.plannedMinutes).toBe(45);
  });

  describe('the reward minute', () => {
    async function rewardToken(now: Date): Promise<string> {
      const banner = await taskId('Banner voor de feestdagen');
      const [started] = await tap(now, `blk:t${banner}:m15`);
      const blockId = Number(/blk:(\d+):stop/.exec(started!.buttons![0]!.id)?.[1]);
      await tap(new Date(now.getTime() + 15 * 60_000), `blk:${blockId}:done`);
      const [back] = await tap(new Date(now.getTime() + 16 * 60_000), `blk:${blockId}:back`);
      return new URL(back!.buttons![0]!.webApp!).searchParams.get('t')!;
    }

    it('times one round of 60 seconds on the server, for the owner only, on the same day', async () => {
      const token = await rewardToken(at('14:00:00'));
      let clock = at('14:17:00');
      const server = await startServer(createApp({ reward: { db: db(), botToken: BOT_TOKEN, now: () => clock } }));
      const post = (path: string, body: unknown) =>
        fetch(`${server.baseUrl}/app/beloning/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const initData = (userId: number, authDate: Date) =>
        signInitData({ auth_date: String(Math.floor(authDate.getTime() / 1000)), user: JSON.stringify({ id: userId }) }, BOT_TOKEN);
      try {
        const page = await fetch(`${server.baseUrl}/app/beloning?t=${token}`);
        expect(page.status).toBe(200);
        expect(await page.text()).toContain('telegram-web-app.js');

        // Wrong user, forged or old initData, unknown token.
        expect((await post('start', { token, initData: initData(999, clock) })).status).toBe(403);
        expect((await post('start', { token, initData: `${initData(OWNER, clock)}0` })).status).toBe(403);
        expect((await post('start', { token, initData: initData(OWNER, new Date(clock.getTime() - 25 * 3_600_000)) })).status).toBe(403);
        expect((await post('start', { token: 'x'.repeat(32) })).status).toBe(404);

        expect(await (await post('start', { token, initData: initData(OWNER, clock) })).json()).toMatchObject({ remaining: 60, finished: false });
        // Reloading gives no extra time.
        clock = at('14:17:20');
        expect(await (await post('start', { token })).json()).toMatchObject({ remaining: 40 });
        clock = at('14:18:05');
        expect(await (await post('start', { token })).json()).toMatchObject({ remaining: 0, finished: true });
        expect(await (await post('start', { token })).json()).toMatchObject({ remaining: 0, finished: true });
      } finally {
        await server.close();
      }
    });

    it('expires at the end of the local day', async () => {
      const token = await rewardToken(at('15:00:00'));
      // 22:30 UTC is 00:30 the next day in Amsterdam.
      const server = await startServer(createApp({ reward: { db: db(), botToken: BOT_TOKEN, now: () => at('22:30:00') } }));
      try {
        const response = await fetch(`${server.baseUrl}/app/beloning/start`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        expect(response.status).toBe(410);
      } finally {
        await server.close();
      }
    });

    it('stores only a hash of the token', async () => {
      const token = await rewardToken(at('16:00:00'));
      const rows = await db().select({ hash: focusBlocks.rewardTokenHash }).from(focusBlocks);
      expect(rows.some((row) => row.hash && row.hash !== token && row.hash.length === 64)).toBe(true);
      expect(JSON.stringify(rows)).not.toContain(token);
    });
  });

  it('plays two blocks and a late return in sim:day, with sound only on the transitions', async () => {
    const { sent } = await simulateDays({ db: db(), userId: t.userId, start: '2026-10-07', days: 1, silent: false, actions: blocksScenario(0) });
    const hf = sent.filter((m) => !m.user && m.at >= at('11:00:00') && m.at < at('12:30:00'));
    expect(hf.map((m) => `${m.silent ? 'stil' : 'geluid'}: ${m.text.split('.')[0]}`)).toEqual([
      'geluid: Hoe lang ga je aan factuur september versturen?',
      'geluid: Top',
      'geluid: Je 25 minuten zitten erop',
      'stil: Mooi gewerkt',
      'stil: Welkom terug',
      'geluid: Top',
      'geluid: Je 15 minuten zitten erop',
      'stil: Mooi gewerkt',
      'geluid: Terug naar je blok?',
      'stil: Welkom terug',
    ]);
    // The reminder comes the minute the pause time is up, not at the next 5-minute step.
    const mission = hf.filter((m) => m.text.startsWith('Mooi gewerkt')).at(-1)!;
    const reminder = hf.find((m) => m.text === 'Terug naar je blok?')!;
    expect([2, 3].map((n) => mission.at.getTime() + n * 60_000)).toContain(reminder.at.getTime());
    // The simulation rolls back.
    expect(await db().select().from(focusBlocks)).toHaveLength(0);
  });

  it('runs a Monday with the weekly mail without parallel queries on one connection', async () => {
    const warnings: string[] = [];
    const listen = (warning: Error) => void warnings.push(warning.message);
    process.on('warning', listen);
    try {
      const { sent } = await simulateDays({ db: db(), userId: t.userId, start: '2026-10-05', days: 1, silent: false });
      expect(sent.some((m) => m.channel === 'email' && m.text.includes('Een nieuwe week'))).toBe(true);
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off('warning', listen);
    }
    expect(warnings.filter((w) => w.includes('already executing a query'))).toEqual([]);
  });

  it('measures blocks, returns and rewards for stats:focus', async () => {
    const banner = await taskId('Banner voor de feestdagen');
    const [started] = await tap(at('17:00:00'), `blk:t${banner}:m15`);
    const blockId = Number(/blk:(\d+):stop/.exec(started!.buttons![0]!.id)?.[1]);
    await tap(at('17:15:00'), `blk:${blockId}:done`);
    await tap(at('17:16:00'), `blk:${blockId}:back`);
    await db().update(focusBlocks).set({ rewardFinishedAt: at('17:17:00') }).where(eq(focusBlocks.id, blockId));
    await tap(at('17:20:00'), `blk:t${banner}:next`);
    const [stats] = await focusStats(db(), at('00:00:00'));
    expect(stats).toMatchObject({ blocksStarted: 2, blocksCompleted: 1, pauses: 1, returnedOnTime: 1, rewardsFinished: 1, backToWorkAfterReward: 1 });
  });
});
