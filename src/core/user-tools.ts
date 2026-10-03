// The user's tools per kind of work (step 1.10).
import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { userTools } from '../db/schema/index.js';
import type { WorkType } from '../tools/catalog.js';

export type UserTool = typeof userTools.$inferSelect;

export async function listUserTools(db: Database, userId: number): Promise<UserTool[]> {
  return db.select().from(userTools).where(eq(userTools.userId, userId)).orderBy(asc(userTools.id));
}

export async function getUserTool(db: Database, userId: number, workType: WorkType): Promise<UserTool | undefined> {
  const [row] = await db
    .select()
    .from(userTools)
    .where(and(eq(userTools.userId, userId), eq(userTools.workType, workType)));
  return row;
}

export async function saveUserTool(
  db: Database,
  userId: number,
  tool: { workType: WorkType; toolKey: string; label: string; url: string },
): Promise<void> {
  await db
    .insert(userTools)
    .values({ userId, ...tool })
    .onConflictDoUpdate({
      target: [userTools.userId, userTools.workType],
      set: { toolKey: tool.toolKey, label: tool.label, url: tool.url, updatedAt: new Date() },
    });
}

export async function removeUserTool(db: Database, userId: number, workType: WorkType): Promise<boolean> {
  const removed = await db
    .delete(userTools)
    .where(and(eq(userTools.userId, userId), eq(userTools.workType, workType)))
    .returning({ id: userTools.id });
  return removed.length > 0;
}
