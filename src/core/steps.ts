// Micro steps are subtasks (parent_task_id). A step can itself be split into smaller steps
// when the user gets stuck, so steps form a small tree under the main task.
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { tasks } from '../db/schema/index.js';
import type { CaptureSource } from './ideas.js';
import { createTask, getTask, setTaskStatus, type Estimate, type TaskSummary } from './tasks.js';

const OPEN = ['open', 'in_progress'] as const;

async function openChildren(db: Database, userId: number, parentId: number) {
  return db
    .select({ id: tasks.id, title: tasks.title, estimatedMinutes: tasks.estimatedMinutes })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.parentTaskId, parentId), inArray(tasks.status, [...OPEN])))
    .orderBy(asc(tasks.id));
}

/** The first open leaf under a task, or the task itself when it has no open steps. */
export async function nextStep(db: Database, userId: number, taskId: number): Promise<TaskSummary | undefined> {
  const [child] = await openChildren(db, userId, taskId);
  if (child) return nextStep(db, userId, child.id);
  return getTask(db, userId, taskId);
}

/** Open direct steps of a task, in order. */
export async function listSteps(db: Database, userId: number, taskId: number) {
  return openChildren(db, userId, taskId);
}

export async function addSteps(
  db: Database,
  userId: number,
  parent: TaskSummary,
  steps: Array<{ title: string; minutes: Estimate }>,
  source: CaptureSource,
): Promise<number[]> {
  const ids: number[] = [];
  for (const step of steps) {
    const { id } = await createTask(db, {
      userId,
      projectId: parent.projectId,
      parentTaskId: parent.id,
      title: step.title,
      estimatedMinutes: step.minutes,
      dueDate: null,
      source,
    });
    ids.push(id);
  }
  return ids;
}

/**
 * Marks a step done. When that was the last open step of its parent, the parent is done
 * too, up to the main task. Returns the highest task that got done.
 */
export async function completeStep(db: Database, userId: number, stepId: number, now: Date): Promise<TaskSummary | undefined> {
  let current = await getTask(db, userId, stepId);
  if (!current) return undefined;
  await setTaskStatus(db, userId, current.id, 'done', now);
  let top = current;
  while (current?.parentTaskId) {
    const remaining = await openChildren(db, userId, current.parentTaskId);
    if (remaining.length > 0) break;
    await setTaskStatus(db, userId, current.parentTaskId, 'done', now);
    current = await getTask(db, userId, current.parentTaskId);
    if (current) top = current;
  }
  return top;
}
