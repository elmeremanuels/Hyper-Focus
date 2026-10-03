import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { signInitData } from '../src/channels/telegram/webapp.js';
import { createAssistantRouter } from '../src/conversation/assistant.js';
import { focusBlocks, users } from '../src/db/schema/index.js';
import { windowFor } from '../src/focus/windows.js';
import { runPlanner } from '../src/proactive/planner.js';
import { scriptedClaude } from './helpers/claude.js';
import { startServer } from './helpers/server.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

const BOT = '123:test';
const OWNER = 4242;
// Amsterdam, summer time: the standard window 10:30–12:00 local is 08:30–10:00 UTC.
const at = (time: string) => new Date(`2026-10-07T${time}Z`);

describe.skipIf(!adminUrl)('dashboard API (integration)', () => {
  const t = useTestDatabase();
  const db = () => t.connection.db;
  const auth = (when: Date, userId = OWNER) => ({
    authorization: `tma ${signInitData({ auth_date: String(Math.floor(when.getTime() / 1000)), user: JSON.stringify({ id: userId }) }, BOT)}`,
  });
  const tap = (when: Date, buttonId: string) =>
    createAssistantRouter({ db: db(), claude: scriptedClaude([]), now: () => when })({ kind: 'button', userId: t.userId, buttonId, title: buttonId });

  it('is off unless DASHBOARD_API=on, and needs a valid Telegram sign-in', async () => {
    const off = await startServer(createApp({}));
    try {
      expect((await fetch(`${off.baseUrl}/api/battery`)).status).toBe(404);
    } finally {
      await off.close();
    }
    await db().update(users).set({ telegramUserId: OWNER }).where(eq(users.id, t.userId));
    const server = await startServer(createApp({ dashboardApi: { db: db(), botToken: BOT, now: () => at('07:00:00') } }));
    try {
      expect((await fetch(`${server.baseUrl}/api/battery`)).status).toBe(401);
      expect((await fetch(`${server.baseUrl}/api/battery`, { headers: { authorization: 'tma user=1&hash=00' } })).status).toBe(401);
      expect((await fetch(`${server.baseUrl}/api/battery`, { headers: auth(at('07:00:00'), 999) })).status).toBe(401);
      const ok = await fetch(`${server.baseUrl}/api/battery`, { headers: auth(at('07:00:00')) });
      expect(ok.status).toBe(200);
      expect(ok.headers.get('cache-control')).toBe('private, max-age=60');
    } finally {
      await server.close();
    }
  });

  it('gives the right state at every moment of a day with a window block and a pitstop', async () => {
    await runPlanner(db(), at('00:00:00')); // plans 7 October (02:00 local)
    const window = (await windowFor(db(), t.userId, '2026-10-07'))!;
    let clock = at('07:00:00');
    const server = await startServer(createApp({ dashboardApi: { db: db(), botToken: BOT, now: () => clock } }));
    const battery = async (time: string) => {
      clock = at(time);
      return (await (await fetch(`${server.baseUrl}/api/battery`, { headers: auth(clock) })).json()) as Record<string, unknown>;
    };
    try {
      expect(await battery('07:00:00')).toMatchObject({ state: 'idle', segments: 2, dimmed: true, label: 'Volgend focusvenster vandaag 10:30' });
      expect(await battery('08:10:00')).toMatchObject({
        state: 'charging',
        segments: 3,
        label: 'Focusvenster over 20 minuten',
        windowStartsAt: '2026-10-07T10:30:00+02:00',
        task: { id: window.taskId, title: 'Offerte bakkerij afmaken' },
        source: 'pref',
      });
      expect(await battery('08:30:00')).toMatchObject({ state: 'ready', segments: 4, label: 'Focusvenster begint. Offerte bakkerij afmaken ligt klaar' });

      await tap(at('08:31:00'), `blk:t${window.taskId}:m60`);
      expect(await battery('09:13:00')).toMatchObject({ state: 'focus', segments: 4, elapsedMinutes: 42, label: 'In focus, 42 minuten' });

      const [block] = await db().select().from(focusBlocks).where(eq(focusBlocks.userId, t.userId));
      const blockId = block!.id;
      await tap(at('09:31:00'), `blk:${blockId}:done`);
      const pitstop = await battery('09:31:30');
      expect(pitstop).toMatchObject({ state: 'pitstop', segments: 2 });
      expect(String(pitstop.label)).toMatch(/^Pitstop, terug om 11:3[34]$/);

      await tap(at('09:32:30'), `blk:${blockId}:back`);
      expect(await battery('09:40:00')).toMatchObject({ state: 'ready', segments: 4 });
      expect(await battery('10:30:00')).toMatchObject({ state: 'idle', segments: 4, dimmed: true, label: 'Volgend focusvenster morgen 10:30' });
    } finally {
      await server.close();
    }
  });

  it('gives the focus log of the last days', async () => {
    const server = await startServer(createApp({ dashboardApi: { db: db(), botToken: BOT, now: () => at('12:00:00') } }));
    try {
      const body = (await (await fetch(`${server.baseUrl}/api/focus-log?days=7`, { headers: auth(at('12:00:00')) })).json()) as { days: number; lines: unknown[] };
      expect(body.days).toBe(7);
      expect(body.lines).toEqual([
        {
          startedAt: '2026-10-07T10:31:00+02:00',
          day: 'Wo',
          time: '10:31',
          minutes: 60,
          title: 'Offerte bakkerij afmaken',
          result: 'Open het offertebestand en schrijf de eerste alinea af',
          inWindow: true,
        },
      ]);
    } finally {
      await server.close();
    }
  });
});
