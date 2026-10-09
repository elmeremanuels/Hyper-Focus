import { and, desc, eq, gte } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { ideas, projects } from '../db/schema/index.js';

export type CaptureSource = 'telegram' | 'voice' | 'email' | 'engine' | 'web' | 'seed';

const WEEK_MS = 7 * 86_400_000;

/** Ideas go to the inbox and never straight into the focus (BOUWPLAN.md, 11.7). */
export async function addIdea(db: Database, userId: number, text: string, source: CaptureSource) {
  const [row] = await db.insert(ideas).values({ userId, text, source }).returning({ id: ideas.id });
  return row;
}

export async function inboxIdeas(db: Database, userId: number) {
  return db
    .select({ id: ideas.id, text: ideas.text, createdAt: ideas.createdAt })
    .from(ideas)
    .where(and(eq(ideas.userId, userId), eq(ideas.status, 'inbox')))
    .orderBy(desc(ideas.createdAt));
}

/** At most one idea becomes a project per week (BOUWPLAN.md, 11.7). */
export async function promotedThisWeek(db: Database, userId: number, now: Date): Promise<boolean> {
  const rows = await db
    .select({ id: ideas.id })
    .from(ideas)
    .where(and(eq(ideas.userId, userId), eq(ideas.status, 'promoted'), gte(ideas.reviewedAt, new Date(now.getTime() - WEEK_MS))))
    .limit(1);
  return rows.length > 0;
}

/** Turns an inbox idea into a project with low priority; it does not enter the focus. */
export async function promoteIdea(db: Database, userId: number, ideaId: number, now: Date): Promise<{ projectId: number; title: string } | undefined> {
  const [idea] = await db
    .select({ id: ideas.id, text: ideas.text, businessId: ideas.businessId })
    .from(ideas)
    .where(and(eq(ideas.userId, userId), eq(ideas.id, ideaId), eq(ideas.status, 'inbox')));
  if (!idea) return undefined;
  const title = idea.text.length <= 80 ? idea.text : `${idea.text.slice(0, 79)}…`;
  const [project] = await db
    .insert(projects)
    .values({ userId, businessId: idea.businessId, title, goal: idea.text, priority: 3 })
    .returning({ id: projects.id });
  if (!project) throw new Error('Failed to create the project');
  await db.update(ideas).set({ status: 'promoted', promotedToProjectId: project.id, reviewedAt: now }).where(eq(ideas.id, idea.id));
  return { projectId: project.id, title };
}
