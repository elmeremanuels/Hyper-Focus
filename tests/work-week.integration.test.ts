import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAssistantRouter } from '../src/conversation/assistant.js';
import { runTool, CORE_TOOLS } from '../src/conversation/tools.js';
import { getSettings } from '../src/core/settings.js';
import { focusWindows, scheduledNudges } from '../src/db/schema/index.js';
import { setFocusPref } from '../src/focus/windows.js';
import { planDay } from '../src/proactive/planner.js';
import { batteryInput } from '../src/web/dashboard-api.js';
import { batteryState } from '../src/focus/battery.js';
import { scriptedClaude } from './helpers/claude.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

const TZ = 'Europe/Amsterdam';

describe.skipIf(!adminUrl)('work week (integration)', () => {
  const t = useTestDatabase();
  const db = () => t.connection.db;
  const router = (now: Date, claude = scriptedClaude([])) => createAssistantRouter({ db: db(), claude, now: () => now });
  const tap = (now: Date, id: string) => router(now)({ kind: 'button', userId: t.userId, buttonId: id, title: id });
  const nudgesOn = async (date: string) =>
    (await db().select().from(scheduledNudges).where(eq(scheduledNudges.userId, t.userId)))
      .filter((n) => n.payload.localDate === date)
      .map((n) => [n.kind, n.scheduledForUtc.toISOString(), n.payload.part ?? null]);

  it('asks the days, then the hours, and confirms with the day of the weekly review', async () => {
    const now = new Date('2026-10-05T07:00:00Z');
    expect((await router(now)({ kind: 'text', userId: t.userId, text: 'mijn werkweek' }))[0]?.text).toBe('Op welke dagen werk je?');
    const [hours] = await tap(now, 'ww:d:1234');
    expect(hours).toMatchObject({ text: 'Hoe laat begin en stop je meestal?' });
    const [saved] = await tap(now, 'ww:h:0800-1600');
    expect(saved?.text).toBe('Genoteerd: ma t/m do, 08:00–16:00. Je weekreview komt op donderdag om 16:00.');
    const settings = await getSettings(db(), t.userId);
    expect([settings.workDays, settings.workStart, settings.workEnd]).toEqual([[1, 2, 3, 4], '08:00:00', '16:00:00']);
  });

  it('plans the weekly review at the end of the last work day, and nothing on a day off', async () => {
    await planDay(db(), t.userId, TZ, new Date('2026-10-07T22:06:00Z')); // Thursday 8 October
    expect(await nudgesOn('2026-10-08')).toContainEqual(['weekly_review', '2026-10-08T14:00:00.000Z', 'review']);
    const [thursday] = await db().select().from(focusWindows).where(and(eq(focusWindows.userId, t.userId), eq(focusWindows.date, '2026-10-08')));
    expect(thursday?.endsAt.getTime()).toBeLessThanOrEqual(new Date('2026-10-08T14:00:00Z').getTime());

    await planDay(db(), t.userId, TZ, new Date('2026-10-08T22:06:00Z')); // Friday: a day off
    expect(await nudgesOn('2026-10-09')).toEqual([]);
    expect(await db().select().from(focusWindows).where(and(eq(focusWindows.userId, t.userId), eq(focusWindows.date, '2026-10-09')))).toHaveLength(0);

    // The battery points to the next work day: Monday.
    const state = batteryState(await batteryInput(db(), t.userId, TZ, new Date('2026-10-09T10:00:00Z')));
    expect(state).toMatchObject({ state: 'idle', label: 'Volgend focusvenster maandag 10:30' });
  });

  it('names the review day for new ideas and sets the week through the router', async () => {
    const idea = await runTool(CORE_TOOLS, 'add_idea', { text: 'Workshop' }, { db: db(), userId: t.userId, timezone: TZ, now: new Date(), source: 'telegram' });
    expect(idea.reply?.text).toBe('Staat in je ideeënbak. Donderdag kijken we ernaar.');

    const claude = scriptedClaude([{ tools: [{ name: 'set_work_week', input: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:30' } }] }]);
    const [reply] = await router(new Date('2026-10-12T08:00:00Z'), claude)({ kind: 'text', userId: t.userId, text: 'ik werk ma t/m vr van 9 tot half 6' });
    expect(reply?.text).toBe('Genoteerd: ma t/m vr, 09:00–17:30. Je weekreview komt op vrijdag om 17:30.');
  });

  it('stretches the work day when someone works best in the evening', async () => {
    await setFocusPref(db(), t.userId, 'evening', new Date());
    expect((await getSettings(db(), t.userId)).workEnd).toBe('20:30:00');
  });
});
