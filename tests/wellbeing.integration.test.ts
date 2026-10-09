import { and, eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAssistantRouter } from '../src/conversation/assistant.js';
import { CRISIS_REPLY } from '../src/conversation/wellbeing.js';
import { events, scheduledNudges, userSettings, users } from '../src/db/schema/index.js';
import { planDay } from '../src/proactive/planner.js';
import { simulateDays, type SimulatedMessage } from '../src/proactive/simulate.js';
import { scriptedClaude } from './helpers/claude.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

const day = (message: SimulatedMessage) => DateTime.fromJSDate(message.at, { zone: 'Europe/Amsterdam' }).toFormat('dd HH:mm');

describe.skipIf(!adminUrl)('guardrails, escalation, restart and crisis (integration)', { timeout: 60_000 }, () => {
  const t = useTestDatabase();
  const db = () => t.connection.db;
  // These tests run through weekends: every day is a work day here (the work week has its own tests).
  beforeAll(async () => {
    await db().update(userSettings).set({ workDays: [1, 2, 3, 4, 5, 6, 7] }).where(eq(userSettings.userId, t.userId));
  });

  it('7 days of silence give exactly the agreed pattern', async () => {
    const { sent } = await simulateDays({ db: db(), userId: t.userId, start: '2026-10-06', days: 8, silent: true });
    expect(sent.map((m) => `${day(m)} ${m.channel} ${m.text.slice(0, 20)}`)).toEqual([
      '06 08:30 telegram Goedemorgen. Dit zij', // day 1: the normal rhythm
      '06 08:40 telegram Wanneer werk je mees', // once: the focus preference, 10 minutes later (P0.1)
      '06 10:15 telegram Over een kwartier je', // the focus window replaces the midday nudge
      '06 11:00 telegram Venster liep anders.',
      '06 16:00 telegram Tijd om de dag af te',
      '07 08:30 telegram Goedemorgen. Dit zij', // day 2: morning only
      '07 08:40 telegram Op welke dagen werk ', // once: the work week, 10 minutes later
      '08 08:30 telegram Welkom terug. Ik heb', // day 3: morning only, as a soft restart
      // days 4–6: silent
      '12 08:30 telegram Welkom terug. Ik heb', // day 7: one restart, in Telegram and by mail
      '12 08:30 email Welkom terug. Ik heb',
      // day 8: silent until the user writes
    ]);
    expect(sent.find((m) => m.text.startsWith('Welkom terug'))?.buttons).toEqual(['Ja', 'Morgen']);
    // Never two messages in the same minute on one channel (verbeterplan P0.1).
    const minutes = sent.map((m) => `${day(m)} ${m.channel}`);
    expect(new Set(minutes).size).toBe(minutes.length);
  });

  it('climbs the escalation ladder one task and one message a day, and parks at level 3', async () => {
    const { sent } = await simulateDays({ db: db(), userId: t.userId, start: '2026-10-06', days: 8, silent: false });
    const escalations = sent.filter((m) => /opknippen\?|blijft liggen|staat op je parkeerplaats/.test(m.text));
    const days = escalations.map((m) => day(m).slice(0, 2));
    expect(new Set(days).size).toBe(days.length);
    expect(escalations.map((m) => (/opknippen\?/.test(m.text) ? 1 : /blijft liggen/.test(m.text) ? 2 : 3))).toContain(3);
    const parked = escalations.find((m) => /staat op je parkeerplaats/.test(m.text));
    expect(parked?.buttons).toEqual(['Terughalen']);

    // Never more than four proactive messages on a day. Not counted: the one-time preference
    // question, the silent missed-window message and the Monday mail.
    const counted = sent.filter((m) => !/^(Wanneer werk je|Op welke dagen werk je|Venster liep anders)/.test(m.text) && m.channel === 'telegram');
    const perDay = new Map<string, number>();
    for (const message of counted) perDay.set(day(message).slice(0, 2), (perDay.get(day(message).slice(0, 2)) ?? 0) + 1);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(4);
  });

  it('sends one message the day after overwhelm', async () => {
    await db().insert(events).values({ userId: t.userId, name: 'overwhelm', props: { date: '2026-10-19' } });
    const { sent, skipped } = await simulateDays({ db: db(), userId: t.userId, start: '2026-10-20', days: 1, silent: false });
    expect(sent.filter((m) => !/^(Wanneer werk je|Op welke dagen werk je)/.test(m.text))).toHaveLength(1);
    expect(skipped.some((s) => s.reason === 'after_overwhelm')).toBe(true);
  });

  it('stops everything and flags a crisis, also without Claude', async () => {
    await planDay(db(), t.userId, 'Europe/Amsterdam', new Date('2026-11-02T06:00:00Z'));
    const router = createAssistantRouter({ db: db(), claude: undefined });
    const replies = await router({ kind: 'text', userId: t.userId, text: 'ik wil er gewoon niet meer zijn' });

    expect(replies).toEqual([CRISIS_REPLY]);
    expect(CRISIS_REPLY.text).toContain('113');
    expect((await db().select().from(users).where(eq(users.id, t.userId)))[0]?.status).toBe('paused');
    const pending = await db()
      .select()
      .from(scheduledNudges)
      .where(and(eq(scheduledNudges.userId, t.userId), eq(scheduledNudges.status, 'pending')));
    expect(pending).toHaveLength(0);
    const flagged = await db().select().from(events).where(and(eq(events.userId, t.userId), eq(events.name, 'crisis_flagged')));
    expect(flagged.map((e) => e.props)).toEqual([{ source: 'pattern' }]);
  });

  it('lets Claude flag subtler crisis messages', async () => {
    await db().update(users).set({ status: 'active' }).where(eq(users.id, t.userId));
    const claude = scriptedClaude([{ tools: [{ name: 'crisis', input: {} }, { name: 'add_task', input: { title: 'Iets', estimated_minutes: 5 } }] }]);
    const router = createAssistantRouter({ db: db(), claude });
    const replies = await router({ kind: 'text', userId: t.userId, text: 'niemand zou het merken als ik weg was' });
    expect(replies).toEqual([CRISIS_REPLY]);
    expect((await db().select().from(users).where(eq(users.id, t.userId)))[0]?.status).toBe('paused');
  });
});
