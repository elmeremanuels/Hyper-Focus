import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { projects, tasks, users } from '../db/schema/index.js';
import type { OpenTask, RouterDeps } from './router.js';

/** Router dependencies backed by the database. */
export function createDbRouterDeps(db: Database): RouterDeps {
  return {
    async findUserName(userId) {
      const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
      return user?.name;
    },

    async listOpenTasks(userId, limit): Promise<OpenTask[]> {
      return db
        .select({
          id: tasks.id,
          title: tasks.title,
          estimatedMinutes: tasks.estimatedMinutes,
          projectTitle: projects.title,
        })
        .from(tasks)
        .innerJoin(projects, eq(tasks.projectId, projects.id))
        .where(
          and(
            eq(tasks.userId, userId),
            inArray(tasks.status, ['open', 'in_progress']),
            isNull(tasks.parentTaskId),
            eq(projects.status, 'active'),
          ),
        )
        .orderBy(
          desc(projects.isWeeklyFocus),
          asc(projects.priority),
          sql`${tasks.dueDate} ASC NULLS LAST`,
          asc(tasks.createdAt),
        )
        .limit(limit);
    },
  };
}

/** Router dependencies without a database, for the simulator. */
export function createMemoryRouterDeps(name: string, openTasks: OpenTask[] = []): RouterDeps {
  return {
    findUserName: async () => name,
    listOpenTasks: async (_userId, limit) => openTasks.slice(0, limit),
  };
}
