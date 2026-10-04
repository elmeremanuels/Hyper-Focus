import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { dailyFocus, focusWindows, scheduledNudges, users } from '../src/db/schema/index.js';
import demo from '../src/db/seed/demo.js';
import { removeDemo, seedDemoWeek } from '../src/demo/week.js';
import { focusLog } from '../src/focus/log.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

// Wednesday 7 October, 10:00 in Amsterdam.
const NOW = new Date('2026-10-07T08:00:00Z');

describe.skipIf(!adminUrl)('demo week (integration)', () => {
  const t = useTestDatabase();
  const db = () => t.connection.db;

  it('creates a paused demo account with five work days of history and a planned today', async () => {
    const { userId } = await seedDemoWeek(db(), demo, NOW);
    const [user] = await db().select().from(users).where(eq(users.id, userId));
    expect(user).toMatchObject({ name: 'Noor', status: 'paused' });

    // Every day is a work day for the demo: the five days before today.
    const windows = await db().select().from(focusWindows).where(eq(focusWindows.userId, userId));
    expect(windows.filter((w) => w.date < '2026-10-07').map((w) => [w.date, w.status])).toEqual([
      ['2026-10-02', 'used'],
      ['2026-10-03', 'used'],
      ['2026-10-04', 'used'],
      ['2026-10-05', 'missed'],
      ['2026-10-06', 'used'],
    ]);
    // Today: the learned window at 09:30, used by the block that ended at 09:55.
    expect(windows.find((w) => w.date === '2026-10-07')).toMatchObject({ source: 'learned', startsAt: new Date('2026-10-07T07:30:00Z'), status: 'used' });
    const [focus] = await db().select().from(dailyFocus).where(and(eq(dailyFocus.userId, userId), eq(dailyFocus.localDate, '2026-10-07')));
    expect(focus?.taskIds.length).toBe(3);

    const log = await focusLog(db(), userId, 'Europe/Amsterdam', new Date('2026-09-28T00:00:00Z'), NOW);
    expect(log).toHaveLength(9);
    expect(log.filter((l) => l.inWindow)).toHaveLength(5);
    expect(log.at(-1)).toMatchObject({ time: '09:30', minutes: 25, inWindow: true });
    expect(log[0]).toMatchObject({ time: '09:35', minutes: 60, inWindow: true });

    expect(await db().select().from(scheduledNudges).where(and(eq(scheduledNudges.userId, userId), eq(scheduledNudges.status, 'pending')))).toEqual([]);
  });

  it('refuses a second run, and starts over after removing', async () => {
    await expect(seedDemoWeek(db(), demo, NOW)).rejects.toThrow('already exists');
    expect(await removeDemo(db(), 'DEMO@voorbeeld.invalid')).toBe(true);
    const again = await seedDemoWeek(db(), demo, NOW);
    expect(again.userId).toBeGreaterThan(0);
  });
});
