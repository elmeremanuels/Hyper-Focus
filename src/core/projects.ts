import { and, asc, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { clients, LOOSE_TASKS_PROJECT_TITLE, projects } from '../db/schema/index.js';

export interface ProjectSummary {
  id: number;
  title: string;
  clientId: number | null;
  clientName: string | null;
  priority: number;
  isWeeklyFocus: boolean;
  deadline: string | null;
}

/** Active projects, weekly focus and high priority first. */
export async function listActiveProjects(db: Database, userId: number): Promise<ProjectSummary[]> {
  return db
    .select({
      id: projects.id,
      title: projects.title,
      clientId: projects.clientId,
      clientName: clients.name,
      priority: projects.priority,
      isWeeklyFocus: projects.isWeeklyFocus,
      deadline: projects.deadline,
    })
    .from(projects)
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .where(and(eq(projects.userId, userId), eq(projects.status, 'active')))
    .orderBy(desc(projects.isWeeklyFocus), asc(projects.priority), asc(projects.id));
}

/** Every user has a "Losse taken" project (BOUWPLAN.md, 8); created when missing. */
export async function getLooseTasksProject(db: Database, userId: number): Promise<number> {
  const [existing] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.title, LOOSE_TASKS_PROJECT_TITLE)));
  if (existing) return existing.id;
  const [created] = await db
    .insert(projects)
    .values({ userId, title: LOOSE_TASKS_PROJECT_TITLE, priority: 3 })
    .returning({ id: projects.id });
  if (!created) throw new Error('Failed to create the loose tasks project');
  return created.id;
}

export async function getProject(db: Database, userId: number, projectId: number) {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.id, projectId)));
  return row;
}

export async function setProjectDeadline(db: Database, userId: number, projectId: number, deadline: string) {
  await db
    .update(projects)
    .set({ deadline })
    .where(and(eq(projects.userId, userId), eq(projects.id, projectId)));
}
