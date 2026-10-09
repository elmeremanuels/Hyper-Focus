// GET /api/today and the actions on it (step 2a.3): the focus with the window, the focus log,
// starting a block, done, to tomorrow, and moving the window.
import { Router } from 'express';
import { z } from 'zod';
import { activeBlock, roundToPreset, startBlock } from '../../conversation/blocks.js';
import { firstSteps, todaysFocus } from '../../conversation/views.js';
import { workplaceButton } from '../../conversation/workplace.js';
import { carryOver, getTask, setTaskStatus } from '../../core/tasks.js';
import { dailyFocus } from '../../db/schema/index.js';
import { focusLog, todayRange } from '../../focus/log.js';
import { localTime, moveWindow, windowFor } from '../../focus/windows.js';
import { localDate, localNow, startOfNextLocalDay } from '../../lib/time.js';
import { and, eq } from 'drizzle-orm';
import { handle, userContext, type DashboardRoutesConfig } from './common.js';

const WEEKDAYS = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];

export function todayRoutes(config: DashboardRoutesConfig): Router {
  const router = Router();

  router.get(
    '/api/today',
    handle(async (_req, res) => {
      const ctx = await userContext(config, res);
      const { db, userId, timezone, now } = ctx;
      const date = localDate(timezone, now);
      const focus = await todaysFocus(db, userId, timezone, now);
      const [planned] = await db
        .select({ quickWinTaskId: dailyFocus.quickWinTaskId })
        .from(dailyFocus)
        .where(and(eq(dailyFocus.userId, userId), eq(dailyFocus.localDate, date)));
      const steps = await firstSteps(db, userId, focus.map((t) => t.id));
      const window = await windowFor(db, userId, date);
      const openWindow = window && (window.status === 'planned' || window.status === 'used') ? window : undefined;

      // Quick wins and steps first; the task of the window last (1.12).
      const windowTask = focus.find((t) => t.id === openWindow?.taskId);
      const ordered = windowTask ? [...focus.filter((t) => t !== windowTask), windowTask] : focus;
      const items = [];
      for (const task of ordered) {
        const link = await workplaceButton(db, userId, task);
        items.push({
          id: task.id,
          title: task.title,
          minutes: task.estimatedMinutes,
          project: task.projectTitle,
          client: task.clientName,
          status: task.status,
          quickWin: task.id === planned?.quickWinTaskId,
          inWindow: task === windowTask,
          step: steps.get(task.id) ?? null,
          link: link?.url ? { title: link.title, url: link.url } : null,
        });
      }

      const { from, to } = todayRange(timezone, now);
      const log = await focusLog(db, userId, timezone, from, to);
      const active = await activeBlock(db, userId, now);
      const local = localNow(timezone, now).setLocale('nl');
      res.set('Cache-Control', 'no-store').json({
        date,
        dayLabel: `${WEEKDAYS[local.weekday - 1]} ${local.toFormat('d LLLL')}`,
        name: ctx.name,
        window: openWindow
          ? { start: localTime(timezone, openWindow.startsAt), end: localTime(timezone, openWindow.endsAt), status: openWindow.status, taskId: openWindow.taskId }
          : null,
        focus: items,
        log: log.map((l) => ({ time: l.time, minutes: l.minutes, title: l.title, result: l.result, inWindow: l.inWindow })),
        activeBlock: active
          ? { phase: active.phase, taskId: active.block.taskId, endsAt: localTime(timezone, active.phase === 'pause' ? (active.block.pauseDueAt ?? active.block.endsAt) : active.block.endsAt) }
          : null,
      });
    }),
  );

  const taskAction = (path: string, run: (ctx: Awaited<ReturnType<typeof userContext>>, taskId: number, body: unknown) => Promise<unknown>) =>
    router.post(
      path,
      handle(async (req, res) => {
        const ctx = await userContext(config, res);
        const taskId = Number(req.params.id);
        const task = Number.isInteger(taskId) ? await getTask(ctx.db, ctx.userId, taskId) : undefined;
        if (!task) return void res.status(404).json({ error: 'Taak niet gevonden' });
        res.json((await run(ctx, taskId, req.body)) ?? { ok: true });
      }),
    );

  taskAction('/api/tasks/:id/done', async (ctx, id) => {
    await setTaskStatus(ctx.db, ctx.userId, id, 'done', ctx.now);
  });
  taskAction('/api/tasks/:id/tomorrow', async (ctx, id) => {
    await carryOver(ctx.db, ctx.userId, id, startOfNextLocalDay(ctx.timezone, ctx.now));
  });
  // A block started here runs like one from Telegram: the end and the pitstop come in Telegram.
  taskAction('/api/tasks/:id/start', async (ctx, id, body) => {
    const { minutes } = z.object({ minutes: z.number().int().min(5).max(120) }).parse(body);
    const replies = await startBlock(ctx, id, roundToPreset(minutes));
    return { text: replies.map((r) => r.text).join('\n\n') };
  });

  router.post(
    '/api/window',
    handle(async (req, res) => {
      const ctx = await userContext(config, res);
      const parsed = z.object({ time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ error: 'Tijd als HH:MM' });
      const row = await moveWindow(ctx, localDate(ctx.timezone, ctx.now), parsed.data.time);
      res.json({ start: localTime(ctx.timezone, row.startsAt), end: localTime(ctx.timezone, row.endsAt) });
    }),
  );

  return router;
}
