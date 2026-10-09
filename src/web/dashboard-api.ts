// The data for the dashboard (step 1.12, A4): GET /api/battery, GET /api/focus-log and
// GET /api/me. Mounted with DASHBOARD_BASE_URL (fase 2a). A request signs in with the dashboard
// session cookie, or with Telegram Web App data: "Authorization: tma <initData>".
import { and, desc, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { Router, type Request } from 'express';
import { DateTime } from 'luxon';
import { validateInitData } from '../channels/telegram/webapp.js';
import { activeBlock } from '../conversation/blocks.js';
import { getSettings } from '../core/settings.js';
import { getTask } from '../core/tasks.js';
import { isWorkday } from '../focus/workweek.js';
import type { Database } from '../db/client.js';
import { focusBlocks, rhythmProfiles, tasks, users } from '../db/schema/index.js';
import { batteryState, type BatteryEvent, type BatteryInput } from '../focus/battery.js';
import { focusLog } from '../focus/log.js';
import { chooseWindow } from '../focus/window.js';
import { windowFor, windowInput } from '../focus/windows.js';
import { localDate, localTimeOnDate } from '../lib/time.js';
import { readCookie, SESSION_COOKIE, sessionUser } from './auth/sessions.js';

export interface DashboardApiConfig {
  db: Database;
  /** TELEGRAM_BOT_TOKEN, to check the Telegram sign-in. */
  botToken: string | undefined;
  now?: () => Date;
}

/** The dashboard should not poll faster than once a minute. */
const CACHE = 'private, max-age=60';
const SMALL_TASK_MINUTES = 15;
const MAX_LOG_DAYS = 31;

export function createDashboardApi(config: DashboardApiConfig): Router {
  const router = Router();
  const now = config.now ?? (() => new Date());

  async function user(req: Request, at: Date) {
    const cookie = readCookie(req.get('cookie'), SESSION_COOKIE);
    const session = cookie ? await sessionUser(config.db, cookie, at) : undefined;
    if (session) {
      const [row] = await config.db.select({ id: users.id, timezone: users.timezone }).from(users).where(eq(users.id, session.userId));
      return row;
    }
    const header = req.get('authorization') ?? '';
    const match = /^tma (.+)$/.exec(header);
    if (!match?.[1] || !config.botToken) return undefined;
    const webApp = validateInitData(match[1], config.botToken, at);
    if (!webApp) return undefined;
    const [row] = await config.db.select({ id: users.id, timezone: users.timezone }).from(users).where(eq(users.telegramUserId, webApp.telegramUserId));
    return row;
  }

  router.get('/api/me', async (req, res, next) => {
    try {
      const me = await user(req, now());
      if (!me) return void res.status(401).json({ error: 'Niet ingelogd' });
      const [row] = await config.db.select({ name: users.name, timezone: users.timezone }).from(users).where(eq(users.id, me.id));
      res.set('Cache-Control', 'no-store').json(row);
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/battery', async (req, res, next) => {
    try {
      const at = now();
      const me = await user(req, at);
      if (!me) return void res.status(401).json({ error: 'Niet ingelogd' });
      res.set('Cache-Control', CACHE).json(batteryState(await batteryInput(config.db, me.id, me.timezone, at)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/focus-log', async (req, res, next) => {
    try {
      const at = now();
      const me = await user(req, at);
      if (!me) return void res.status(401).json({ error: 'Niet ingelogd' });
      const days = Math.min(MAX_LOG_DAYS, Math.max(1, Number(req.query.days) || 7));
      const from = DateTime.fromJSDate(at, { zone: me.timezone }).startOf('day').minus({ days: days - 1 }).toJSDate();
      const lines = await focusLog(config.db, me.id, me.timezone, from, at);
      res.set('Cache-Control', CACHE).json({
        days,
        lines: lines.map((line) => ({
          startedAt: DateTime.fromJSDate(line.startedAt, { zone: me.timezone }).toISO({ suppressMilliseconds: true }),
          day: line.day,
          time: line.time,
          minutes: line.minutes,
          title: line.title,
          result: line.result,
          inWindow: line.inWindow,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/** Everything batteryState needs, from the database. */
export async function batteryInput(db: Database, userId: number, timezone: string, now: Date): Promise<BatteryInput> {
  const today = localDate(timezone, now);
  const row = await windowFor(db, userId, today);
  const task = row?.taskId ? await getTask(db, userId, row.taskId) : undefined;
  let confidence: number | null = null;
  if (row?.source === 'learned') {
    const weekday = DateTime.fromISO(today).weekday;
    const [profile] = await db.select({ confidence: rhythmProfiles.confidence }).from(rhythmProfiles).where(and(eq(rhythmProfiles.userId, userId), eq(rhythmProfiles.weekday, weekday)));
    confidence = profile?.confidence ?? null;
  }

  // The next window is on the next work day (step 1.12).
  const { workDays } = await getSettings(db, userId);
  let next = DateTime.fromISO(today).plus({ days: 1 });
  for (let i = 0; i < 7 && !isWorkday(workDays, next.weekday); i++) next = next.plus({ days: 1 });
  const nextDate = next.toISODate() ?? today;
  const planned = await windowFor(db, userId, nextDate);
  const choice = planned ? undefined : chooseWindow(await windowInput(db, userId, nextDate));
  const nextStart = planned?.startsAt ?? localTimeOnDate(timezone, nextDate, choice?.start ?? '10:30');
  const nextWindow = { startsAt: nextStart, endsAt: planned?.endsAt ?? new Date(nextStart.getTime() + (choice?.minutes ?? 90) * 60_000) };

  const active = await activeBlock(db, userId, now);
  const hourAgo = new Date(now.getTime() - 60 * 60_000);
  const small = await db
    .select({ at: tasks.completedAt })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.status, 'done'), lte(tasks.estimatedMinutes, SMALL_TASK_MINUTES), gte(tasks.completedAt, hourAgo)));
  const pitstops = await db
    .select({ at: focusBlocks.returnedAt })
    .from(focusBlocks)
    .where(and(eq(focusBlocks.userId, userId), isNotNull(focusBlocks.returnedAt), gte(focusBlocks.returnedAt, hourAgo)));
  const recentEvents: BatteryEvent[] = [
    ...small.flatMap((r) => (r.at ? [{ kind: 'small_task_done' as const, at: r.at }] : [])),
    ...pitstops.flatMap((r) => (r.at ? [{ kind: 'pitstop_done' as const, at: r.at }] : [])),
  ];

  // Idle shows the last state dimmed: full after a pitstop today, otherwise half.
  const [last] = await db
    .select({ returnedAt: focusBlocks.returnedAt })
    .from(focusBlocks)
    .where(and(eq(focusBlocks.userId, userId), gte(focusBlocks.startedAt, DateTime.fromJSDate(now, { zone: timezone }).startOf('day').toJSDate())))
    .orderBy(desc(focusBlocks.startedAt))
    .limit(1);

  return {
    now,
    timezone,
    window: row
      ? { startsAt: row.startsAt, endsAt: row.endsAt, status: row.status, source: row.source, task: task ? { id: task.id, title: task.title } : null, confidence }
      : undefined,
    nextWindow,
    activeBlock: active
      ? {
          phase: active.phase,
          startedAt: active.block.startedAt,
          inWindow: active.block.inWindow,
          pauseStartedAt: active.block.pauseStartedAt,
          pauseDueAt: active.block.pauseDueAt,
        }
      : undefined,
    recentEvents,
    lastSegments: last?.returnedAt ? 4 : 2,
  };
}
