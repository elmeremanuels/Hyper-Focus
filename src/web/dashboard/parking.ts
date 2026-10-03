// Parkeerplaats & ideeënbak (step 2a.5): parked tasks back or let go, ideas added, edited,
// archived, or promoted to a project (at most one a week, BOUWPLAN.md 11.7).
import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { addIdea, inboxIdeas, promoteIdea, promotedThisWeek } from '../../core/ideas.js';
import { getTask, listParkedTasks, setTaskStatus } from '../../core/tasks.js';
import { ideas } from '../../db/schema/index.js';
import { localDate } from '../../lib/time.js';
import { handle, userContext, type DashboardRoutesConfig } from './common.js';

const ideaText = z.object({ text: z.string().trim().min(1).max(2000) });

export function parkingRoutes(config: DashboardRoutesConfig): Router {
  const router = Router();

  router.get(
    '/api/parking',
    handle(async (_req, res) => {
      const { db, userId, timezone, now } = await userContext(config, res);
      const parked = await listParkedTasks(db, userId, 100);
      const inbox = await inboxIdeas(db, userId);
      res.set('Cache-Control', 'no-store').json({
        parked: parked.map((t) => ({ id: t.id, title: t.title, project: t.projectTitle, client: t.clientName, minutes: t.estimatedMinutes })),
        ideas: inbox.map((i) => ({ id: i.id, text: i.text, date: localDate(timezone, i.createdAt) })),
        canPromote: !(await promotedThisWeek(db, userId, now)),
      });
    }),
  );

  // Only a parked task comes back or is let go from here.
  const parkedAction = (path: string, status: 'open' | 'released') =>
    router.post(
      path,
      handle(async (req, res) => {
        const { db, userId, now } = await userContext(config, res);
        const task = await getTask(db, userId, Number(req.params.id) || 0);
        if (!task || task.status !== 'parked') return void res.status(404).json({ error: 'Taak niet gevonden' });
        await setTaskStatus(db, userId, task.id, status, now);
        res.json({ ok: true });
      }),
    );
  parkedAction('/api/tasks/:id/unpark', 'open');
  parkedAction('/api/tasks/:id/release', 'released');

  router.post(
    '/api/ideas',
    handle(async (req, res) => {
      const { db, userId } = await userContext(config, res);
      const { text } = ideaText.parse(req.body);
      res.status(201).json(await addIdea(db, userId, text, 'web'));
    }),
  );

  const inboxIdea = async (userId: number, raw: string | undefined) => {
    const ideaId = Number(raw);
    if (!Number.isInteger(ideaId)) return undefined;
    const [row] = await config.db
      .select({ id: ideas.id })
      .from(ideas)
      .where(and(eq(ideas.userId, userId), eq(ideas.id, ideaId), eq(ideas.status, 'inbox')));
    return row;
  };
  const notFound = { error: 'Idee niet gevonden' };

  router.patch(
    '/api/ideas/:id',
    handle(async (req, res) => {
      const { db, userId } = await userContext(config, res);
      const idea = await inboxIdea(userId, req.params.id);
      if (!idea) return void res.status(404).json(notFound);
      const { text } = ideaText.parse(req.body);
      await db.update(ideas).set({ text }).where(eq(ideas.id, idea.id));
      res.json({ ok: true });
    }),
  );

  router.post(
    '/api/ideas/:id/archive',
    handle(async (req, res) => {
      const { db, userId, now } = await userContext(config, res);
      const idea = await inboxIdea(userId, req.params.id);
      if (!idea) return void res.status(404).json(notFound);
      await db.update(ideas).set({ status: 'archived', reviewedAt: now }).where(eq(ideas.id, idea.id));
      res.json({ ok: true });
    }),
  );

  router.post(
    '/api/ideas/:id/promote',
    handle(async (req, res) => {
      const { db, userId, now } = await userContext(config, res);
      const idea = await inboxIdea(userId, req.params.id);
      if (!idea) return void res.status(404).json(notFound);
      if (await promotedThisWeek(db, userId, now)) return void res.status(409).json({ error: 'Deze week is er al een idee gepromoveerd' });
      res.json(await promoteIdea(db, userId, idea.id, now));
    }),
  );

  return router;
}
