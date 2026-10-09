import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/conversation/blocks.js';
import { events, focusBlocks, focusWindows, tasks } from '../src/db/schema/index.js';
import { focusLog, formatLogLine, hoursLabel, weekYield } from '../src/focus/log.js';
import { startServer } from './helpers/server.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

const at = (day: string, time: string) => new Date(`${day}T${time}Z`);
const TZ = 'Europe/Amsterdam';

describe.skipIf(!adminUrl)('focus log and weekly yield (integration)', () => {
  const t = useTestDatabase();
  const db = () => t.connection.db;
  const task = async (title: string) => (await db().select().from(tasks).where(eq(tasks.title, title)))[0]!;
  const block = (overrides: Partial<typeof focusBlocks.$inferInsert>) => ({
    userId: t.userId,
    plannedMinutes: 60,
    startedAt: at('2026-10-06', '08:30:00'),
    endsAt: at('2026-10-06', '09:30:00'),
    endedAt: at('2026-10-06', '09:52:00'),
    outcome: 'completed' as const,
    ...overrides,
  });

  it('lists only finished blocks, marks window blocks and says what got done', async () => {
    const offerte = await task('Offerte bakkerij afmaken');
    const banner = await task('Banner voor de feestdagen');
    await db().insert(focusBlocks).values([
      block({ taskId: offerte.id, inWindow: true, outcome: 'extended', extendedMinutes: 30, resultNote: 'Offerte bakkerij afmaken af' }),
      block({ taskId: banner.id, startedAt: at('2026-10-06', '11:00:00'), endsAt: at('2026-10-06', '11:15:00'), endedAt: at('2026-10-06', '11:15:00') }),
      block({ taskId: banner.id, startedAt: at('2026-10-06', '12:00:00'), endedAt: at('2026-10-06', '12:05:00'), outcome: 'stopped' }),
      block({ taskId: banner.id, startedAt: at('2026-10-06', '13:00:00'), endedAt: at('2026-10-06', '13:30:00'), outcome: 'expired' }),
    ]);
    const log = await focusLog(db(), t.userId, TZ, at('2026-10-05', '22:00:00'), at('2026-10-06', '22:00:00'));
    expect(log.map(formatLogLine)).toEqual(['■ Di 10:30 · 82 min · Offerte bakkerij afmaken af', 'Di 13:00 · 15 min · Banner voor de feestdagen']);
  });

  it('sums the week in work: windows, deep work, what went out, the best window', async () => {
    await db().insert(focusWindows).values({
      userId: t.userId,
      date: '2026-10-06',
      startsAt: at('2026-10-06', '08:30:00'),
      endsAt: at('2026-10-06', '10:00:00'),
      source: 'pref',
      status: 'used',
    });
    const done = (title: string, workType: 'invoicing' | 'email') =>
      db().update(tasks).set({ status: 'done', workType, completedAt: at('2026-10-07', '10:00:00') }).where(eq(tasks.title, title));
    await done('Offerte bakkerij afmaken', 'invoicing');
    await done('Factuur september versturen', 'invoicing');
    await db().insert(tasks).values({ userId: t.userId, projectId: (await task('Banner voor de feestdagen')).projectId, title: 'Offerte Boho', source: 'telegram', status: 'done', workType: 'invoicing', completedAt: at('2026-10-07', '11:00:00') });
    expect(await weekYield(db(), t.userId, TZ, at('2026-10-09', '15:00:00'))).toEqual([
      'Deze week: 1 focusvensters, 1,5 uur diep werk.',
      'De deur uit: 2 offertes, 1 factuur.',
      'Beste venster: dinsdag 10:30, 82 minuten.',
    ]);
    expect([10, 45, 60, 82, 300].map(hoursLabel)).toEqual(['0,5', '1', '1', '1,5', '5']);
  });

  it('leaves out what is not there', async () => {
    expect(await weekYield(db(), t.userId, TZ, at('2026-11-30', '15:00:00'))).toEqual([]);
  });

  it('shows today\'s focus log in the mini-app and counts the opening', async () => {
    const token = 'logtoken-' + 'x'.repeat(24);
    await db().insert(focusBlocks).values(block({ taskId: (await task('Banner voor de feestdagen')).id, rewardTokenHash: hashToken(token), startedAt: at('2026-10-06', '14:00:00'), endedAt: at('2026-10-06', '14:25:00') }));
    const server = await startServer(createApp({ reward: { db: db(), botToken: 'x', now: () => at('2026-10-06', '15:00:00') } }));
    try {
      const page = await (await fetch(`${server.baseUrl}/app/beloning?t=${token}`)).text();
      expect(page).toContain('Vandaag gedaan');
      expect(page).toContain('Terug naar je werk');
      expect(page).not.toMatch(/plant|tuin|druppel/i);
      const font = await fetch(`${server.baseUrl}/app/fonts/space-grotesk-700.woff2`);
      expect(font.status).toBe(200);
      expect(font.headers.get('content-type')).toContain('font/woff2');
      expect((await fetch(`${server.baseUrl}/app/fonts/other.woff2`)).status).toBe(404);

      const res = await fetch(`${server.baseUrl}/app/beloning/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
      const body = (await res.json()) as { remaining: number; log: string[] };
      expect(body.remaining).toBe(60);
      expect(body.log).toEqual(['■ Di 10:30 · 82 min · Offerte bakkerij afmaken af', 'Di 13:00 · 15 min · Banner voor de feestdagen', 'Di 16:00 · 25 min · Banner voor de feestdagen']);
      const opened = await db().select().from(events).where(and(eq(events.userId, t.userId), eq(events.name, 'focus_log_opened')));
      expect(opened).toHaveLength(1);
    } finally {
      await server.close();
    }
  });
});
