// Projecten & klanten (step 2a.4): lists, add and edit, and moving tasks between projects.
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { createTask, ESTIMATES, getTask, setTaskStatus } from '../../core/tasks.js';
import { clients, LOOSE_TASKS_PROJECT_TITLE, projects, tasks } from '../../db/schema/index.js';
import { getLooseTasksProject } from '../../core/projects.js';
import { handle, userContext, type DashboardRoutesConfig } from './common.js';

const title = z.string().trim().min(1).max(200);
const minutes = z.number().refine((m): m is (typeof ESTIMATES)[number] => (ESTIMATES as readonly number[]).includes(m));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.number().int().positive();

const newProject = z.object({ title, clientId: id.nullable().optional() });
const projectPatch = z
  .object({
    title,
    clientId: id.nullable(),
    deadline: date.nullable(),
    priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    isWeeklyFocus: z.boolean(),
    status: z.enum(['active', 'parked', 'done']),
  })
  .partial();
const newTask = z.object({ title, minutes: minutes.nullable().optional() });
const taskPatch = z.object({ title, minutes: minutes.nullable(), dueDate: date.nullable(), projectId: id }).partial();
const newClient = z.object({ name: title, contactName: z.string().trim().max(200).nullable().optional() });
const clientPatch = z
  .object({ name: title, contactName: z.string().trim().max(200).nullable(), notes: z.string().max(5000).nullable(), status: z.enum(['active', 'paused', 'ended']) })
  .partial();

const notFound = (what: string) => ({ error: `${what} niet gevonden` });

export function projectRoutes(config: DashboardRoutesConfig): Router {
  const router = Router();

  router.get(
    '/api/projects',
    handle(async (_req, res) => {
      const { db, userId } = await userContext(config, res);
      await getLooseTasksProject(db, userId);
      const projectRows = await db
        .select({
          id: projects.id,
          title: projects.title,
          clientId: projects.clientId,
          deadline: projects.deadline,
          priority: projects.priority,
          isWeeklyFocus: projects.isWeeklyFocus,
          status: projects.status,
        })
        .from(projects)
        .where(and(eq(projects.userId, userId), ne(projects.status, 'done')))
        .orderBy(desc(projects.isWeeklyFocus), asc(projects.priority), asc(projects.id));
      const taskRows = projectRows.length
        ? await db
            .select({ id: tasks.id, projectId: tasks.projectId, title: tasks.title, minutes: tasks.estimatedMinutes, dueDate: tasks.dueDate, status: tasks.status })
            .from(tasks)
            .where(
              and(
                eq(tasks.userId, userId),
                inArray(tasks.projectId, projectRows.map((p) => p.id)),
                inArray(tasks.status, ['open', 'in_progress']),
                isNull(tasks.parentTaskId),
              ),
            )
            .orderBy(asc(tasks.id))
        : [];
      const clientRows = await db
        .select({ id: clients.id, name: clients.name, contactName: clients.contactName, notes: clients.notes, status: clients.status })
        .from(clients)
        .where(and(eq(clients.userId, userId), ne(clients.status, 'ended')))
        .orderBy(asc(clients.name));

      // "Losse taken" goes last: it is the drawer, not a project you steer.
      const loose = (p: { title: string }) => p.title === LOOSE_TASKS_PROJECT_TITLE;
      const ordered = [...projectRows.filter((p) => !loose(p)), ...projectRows.filter(loose)];
      res.set('Cache-Control', 'no-store').json({
        projects: ordered.map((p) => ({
          ...p,
          loose: loose(p),
          client: clientRows.find((c) => c.id === p.clientId)?.name ?? null,
          tasks: taskRows.filter((t) => t.projectId === p.id).map(({ projectId: _, ...t }) => t),
        })),
        clients: clientRows.map((c) => ({ ...c, projects: projectRows.filter((p) => p.clientId === c.id && !loose(p)).length })),
      });
    }),
  );

  router.post(
    '/api/projects',
    handle(async (req, res) => {
      const { db, userId } = await userContext(config, res);
      const body = newProject.parse(req.body);
      if (body.clientId && !(await ownClient(userId, body.clientId))) return void res.status(404).json(notFound('Klant'));
      const [row] = await db
        .insert(projects)
        .values({ userId, title: body.title, clientId: body.clientId ?? null })
        .returning({ id: projects.id });
      res.status(201).json(row);
    }),
  );

  router.patch(
    '/api/projects/:id',
    handle(async (req, res) => {
      const { db, userId } = await userContext(config, res);
      const project = await ownProject(userId, Number(req.params.id));
      if (!project) return void res.status(404).json(notFound('Project'));
      const patch = projectPatch.parse(req.body);
      // The drawer for loose tasks keeps its name and stays active.
      if (project.title === LOOSE_TASKS_PROJECT_TITLE && (patch.title !== undefined || patch.status !== undefined)) {
        return void res.status(400).json({ error: 'Losse taken blijft zoals het is' });
      }
      if (patch.clientId && !(await ownClient(userId, patch.clientId))) return void res.status(404).json(notFound('Klant'));
      if (Object.keys(patch).length) await db.update(projects).set(patch).where(eq(projects.id, project.id));
      res.json({ ok: true });
    }),
  );

  router.post(
    '/api/projects/:id/tasks',
    handle(async (req, res) => {
      const { db, userId } = await userContext(config, res);
      const project = await ownProject(userId, Number(req.params.id));
      if (!project) return void res.status(404).json(notFound('Project'));
      const body = newTask.parse(req.body);
      const row = await createTask(db, { userId, projectId: project.id, title: body.title, estimatedMinutes: body.minutes ?? null, dueDate: null, source: 'web' });
      res.status(201).json(row);
    }),
  );

  router.patch(
    '/api/tasks/:id',
    handle(async (req, res) => {
      const { db, userId } = await userContext(config, res);
      const task = await getTask(db, userId, Number(req.params.id));
      if (!task) return void res.status(404).json(notFound('Taak'));
      const patch = taskPatch.parse(req.body);
      if (patch.projectId && !(await ownProject(userId, patch.projectId))) return void res.status(404).json(notFound('Project'));
      const set = {
        ...(patch.title !== undefined && { title: patch.title }),
        ...(patch.minutes !== undefined && { estimatedMinutes: patch.minutes }),
        ...(patch.dueDate !== undefined && { dueDate: patch.dueDate }),
        ...(patch.projectId !== undefined && { projectId: patch.projectId }),
      };
      if (Object.keys(set).length) {
        await db.update(tasks).set(set).where(and(eq(tasks.userId, userId), eq(tasks.id, task.id)));
        // Micro steps move along with their task.
        if (patch.projectId !== undefined) await db.update(tasks).set({ projectId: patch.projectId }).where(and(eq(tasks.userId, userId), eq(tasks.parentTaskId, task.id)));
      }
      res.json({ ok: true });
    }),
  );

  router.post(
    '/api/tasks/:id/park',
    handle(async (req, res) => {
      const { db, userId, now } = await userContext(config, res);
      const ok = await setTaskStatus(db, userId, Number(req.params.id) || 0, 'parked', now);
      if (!ok) return void res.status(404).json(notFound('Taak'));
      res.json({ ok: true });
    }),
  );

  router.post(
    '/api/clients',
    handle(async (req, res) => {
      const { db, userId } = await userContext(config, res);
      const body = newClient.parse(req.body);
      const [row] = await db
        .insert(clients)
        .values({ userId, name: body.name, contactName: body.contactName ?? null })
        .returning({ id: clients.id });
      res.status(201).json(row);
    }),
  );

  router.patch(
    '/api/clients/:id',
    handle(async (req, res) => {
      const { db, userId } = await userContext(config, res);
      const client = await ownClient(userId, Number(req.params.id));
      if (!client) return void res.status(404).json(notFound('Klant'));
      const patch = clientPatch.parse(req.body);
      if (Object.keys(patch).length) await db.update(clients).set(patch).where(eq(clients.id, client.id));
      res.json({ ok: true });
    }),
  );

  async function ownProject(userId: number, projectId: number) {
    if (!Number.isInteger(projectId)) return undefined;
    const [row] = await config.db
      .select({ id: projects.id, title: projects.title })
      .from(projects)
      .where(and(eq(projects.userId, userId), eq(projects.id, projectId)));
    return row;
  }
  async function ownClient(userId: number, clientId: number) {
    if (!Number.isInteger(clientId)) return undefined;
    const [row] = await config.db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.userId, userId), eq(clients.id, clientId)));
    return row;
  }

  return router;
}
