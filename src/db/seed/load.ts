import { eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import {
  businesses,
  clients,
  conversationState,
  ideas,
  LOOSE_TASKS_PROJECT_TITLE,
  projects,
  tasks,
  users,
  userSettings,
} from '../schema/index.js';
import type { SeedData, SeedTask } from './types.js';

export interface SeedResult {
  userId: number;
  created: boolean;
}

/** Loads seed data for one user. Skips the user if the mail address already exists. */
export async function loadSeed(db: Database, data: SeedData): Promise<SeedResult> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, data.user.email.toLowerCase()));
    if (existing) {
      return { userId: existing.id, created: false };
    }

    const [user] = await tx
      .insert(users)
      .values({
        name: data.user.name,
        email: data.user.email.toLowerCase(),
        ...(data.user.telegramUserId !== undefined && {
          telegramUserId: data.user.telegramUserId,
          telegramChatId: data.user.telegramUserId,
          telegramLinkedAt: new Date(),
        }),
        ...(data.user.timezone !== undefined && { timezone: data.user.timezone }),
      })
      .returning({ id: users.id });
    if (!user) throw new Error('Failed to insert user');
    const userId = user.id;

    await tx.insert(userSettings).values({ userId });
    await tx.insert(conversationState).values({ userId });

    const [business] = await tx
      .insert(businesses)
      .values({ userId, isFocus: true, ...data.business })
      .returning({ id: businesses.id });
    if (!business) throw new Error('Failed to insert business');

    const clientIds = new Map<string, number>();
    for (const client of data.clients) {
      const [row] = await tx
        .insert(clients)
        .values({ userId, businessId: business.id, ...client })
        .returning({ id: clients.id });
      if (row) clientIds.set(client.name, row.id);
    }

    const insertTasks = async (projectId: number, seedTasks: SeedTask[] = []) => {
      for (const task of seedTasks) {
        const [parent] = await tx
          .insert(tasks)
          .values({
            userId,
            projectId,
            title: task.title,
            estimatedMinutes: task.estimatedMinutes ?? null,
            dueDate: task.dueDate ?? null,
            status: task.status ?? 'open',
            source: 'seed',
          })
          .returning({ id: tasks.id });
        if (!parent) continue;

        for (const step of task.microSteps ?? []) {
          await tx.insert(tasks).values({
            userId,
            projectId,
            parentTaskId: parent.id,
            title: step,
            estimatedMinutes: 15,
            source: 'seed',
          });
        }
      }
    };

    // Every user gets a "Losse taken" project.
    const [loose] = await tx
      .insert(projects)
      .values({ userId, title: LOOSE_TASKS_PROJECT_TITLE, priority: 3 })
      .returning({ id: projects.id });
    if (!loose) throw new Error('Failed to insert loose tasks project');
    await insertTasks(loose.id, data.looseTasks);

    for (const project of data.projects) {
      const clientId = project.client ? clientIds.get(project.client) : undefined;
      if (project.client && clientId === undefined) {
        throw new Error(`Unknown client in seed data: ${project.client}`);
      }
      const [row] = await tx
        .insert(projects)
        .values({
          userId,
          businessId: business.id,
          clientId: clientId ?? null,
          title: project.title,
          goal: project.goal ?? null,
          priority: project.priority ?? 2,
          deadline: project.deadline ?? null,
          isWeeklyFocus: project.isWeeklyFocus ?? false,
        })
        .returning({ id: projects.id });
      if (row) await insertTasks(row.id, project.tasks);
    }

    for (const text of data.ideas ?? []) {
      await tx.insert(ideas).values({ userId, businessId: business.id, text, source: 'seed' });
    }

    return { userId, created: true };
  });
}
