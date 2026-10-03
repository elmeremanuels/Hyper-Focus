import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { clients, projects, tasks } from '../db/schema/index.js';
import { recordEvent } from './events.js';
import type { CaptureSource } from './ideas.js';

export type TaskStatus = 'open' | 'in_progress' | 'parked' | 'done' | 'released';
export const ESTIMATES = [5, 15, 30, 60, 120] as const;
export type Estimate = (typeof ESTIMATES)[number];

export interface TaskSummary {
  id: number;
  title: string;
  status: TaskStatus;
  estimatedMinutes: number | null;
  dueDate: string | null;
  projectId: number;
  projectTitle: string;
  clientName: string | null;
  carryOver: boolean;
  createdAt: Date;
  parentTaskId: number | null;
}

const summaryColumns = {
  id: tasks.id,
  title: tasks.title,
  status: tasks.status,
  estimatedMinutes: tasks.estimatedMinutes,
  dueDate: tasks.dueDate,
  projectId: tasks.projectId,
  projectTitle: projects.title,
  clientName: clients.name,
  carryOver: tasks.carryOver,
  createdAt: tasks.createdAt,
  parentTaskId: tasks.parentTaskId,
};

/**
 * Open top-level tasks from active projects that are not snoozed past `now`,
 * weekly focus, priority and deadline first.
 */
export async function listOpenTasks(
  db: Database,
  userId: number,
  limit: number,
  now: Date = new Date(),
): Promise<TaskSummary[]> {
  return db
    .select(summaryColumns)
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .where(
      and(
        eq(tasks.userId, userId),
        inArray(tasks.status, ['open', 'in_progress']),
        isNull(tasks.parentTaskId),
        eq(projects.status, 'active'),
        or(isNull(tasks.snoozedUntil), lte(tasks.snoozedUntil, now)),
      ),
    )
    .orderBy(
      desc(projects.isWeeklyFocus),
      asc(projects.priority),
      sql`${tasks.dueDate} ASC NULLS LAST`,
      asc(tasks.createdAt),
    )
    .limit(limit);
}

export async function listParkedTasks(db: Database, userId: number, limit = 10): Promise<TaskSummary[]> {
  return db
    .select(summaryColumns)
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .where(and(eq(tasks.userId, userId), eq(tasks.status, 'parked'), isNull(tasks.parentTaskId)))
    .orderBy(desc(tasks.updatedAt))
    .limit(limit);
}

export async function getTask(db: Database, userId: number, taskId: number): Promise<TaskSummary | undefined> {
  const [row] = await db
    .select(summaryColumns)
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .where(and(eq(tasks.userId, userId), eq(tasks.id, taskId)));
  return row;
}

/** Tasks by id, in the given order, one query at a time. Missing ids are left out. */
export async function getTasksInOrder(db: Database, userId: number, taskIds: number[]): Promise<TaskSummary[]> {
  const found: TaskSummary[] = [];
  for (const id of taskIds) {
    const task = await getTask(db, userId, id);
    if (task) found.push(task);
  }
  return found;
}

export interface NewTask {
  userId: number;
  projectId: number;
  title: string;
  estimatedMinutes: Estimate | null;
  dueDate: string | null;
  notes?: string | null;
  source: CaptureSource;
  parentTaskId?: number | null;
}

export async function createTask(db: Database, task: NewTask): Promise<{ id: number }> {
  const [row] = await db
    .insert(tasks)
    .values({
      userId: task.userId,
      projectId: task.projectId,
      parentTaskId: task.parentTaskId ?? null,
      title: task.title,
      notes: task.notes ?? null,
      estimatedMinutes: task.estimatedMinutes,
      dueDate: task.dueDate,
      source: task.source,
    })
    .returning({ id: tasks.id });
  if (!row) throw new Error('Failed to create task');
  await recordEvent(db, task.userId, 'task_created', { source: task.source, estimated: task.estimatedMinutes });
  return row;
}

export async function setTaskStatus(
  db: Database,
  userId: number,
  taskId: number,
  status: TaskStatus,
  now: Date = new Date(),
): Promise<boolean> {
  const updated = await db
    .update(tasks)
    .set({
      status,
      completedAt: status === 'done' ? now : null,
      ...(status === 'in_progress' || status === 'done' ? { stuckSince: null, lastEscalationLevel: 0 } : {}),
      ...(status !== 'open' && status !== 'in_progress' ? { carryOver: false, snoozedUntil: null } : {}),
    })
    .where(and(eq(tasks.userId, userId), eq(tasks.id, taskId)))
    .returning({ id: tasks.id });
  if (updated.length === 0) return false;
  await recordEvent(db, userId, 'task_status_changed', { status });
  return true;
}

/** "Morgen verder": keep the task for tomorrow (BOUWPLAN.md, 8 carry_over). */
export async function carryOver(db: Database, userId: number, taskId: number, until: Date): Promise<boolean> {
  const updated = await db
    .update(tasks)
    .set({ carryOver: true, snoozedUntil: until })
    .where(and(eq(tasks.userId, userId), eq(tasks.id, taskId)))
    .returning({ id: tasks.id });
  return updated.length > 0;
}

export async function snoozeTask(db: Database, userId: number, taskId: number, until: Date): Promise<boolean> {
  const updated = await db
    .update(tasks)
    .set({ snoozedUntil: until })
    .where(and(eq(tasks.userId, userId), eq(tasks.id, taskId)))
    .returning({ id: tasks.id });
  return updated.length > 0;
}

export async function moveTask(db: Database, userId: number, taskId: number, projectId: number): Promise<boolean> {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.id, projectId)));
  if (!project) return false;
  const updated = await db
    .update(tasks)
    .set({ projectId })
    .where(and(eq(tasks.userId, userId), eq(tasks.id, taskId)))
    .returning({ id: tasks.id });
  return updated.length > 0;
}

export async function updateTaskDetails(
  db: Database,
  userId: number,
  taskId: number,
  patch: { dueDate?: string; appendNote?: string },
): Promise<boolean> {
  const task = await db
    .select({ notes: tasks.notes })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.id, taskId)));
  const current = task[0];
  if (!current) return false;
  await db
    .update(tasks)
    .set({
      ...(patch.dueDate !== undefined && { dueDate: patch.dueDate }),
      ...(patch.appendNote !== undefined && {
        notes: current.notes ? `${current.notes}\n${patch.appendNote}` : patch.appendNote,
      }),
    })
    .where(and(eq(tasks.userId, userId), eq(tasks.id, taskId)));
  return true;
}
