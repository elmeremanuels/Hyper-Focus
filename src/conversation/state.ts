import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { conversationState } from '../db/schema/index.js';

export type ConversationMode = 'idle' | 'session' | 'wrapup' | 'weekly_review' | 'intake' | 'onboarding' | 'post_edit';

export interface ConversationStateRow {
  mode: ConversationMode;
  data: Record<string, unknown>;
  expiresAt: Date | null;
}

/** The active mode, or idle when none is set or it expired (BOUWPLAN.md, 10.1 step 2). */
export async function getState(db: Database, userId: number, now: Date = new Date()): Promise<ConversationStateRow> {
  const [row] = await db
    .select({ mode: conversationState.mode, data: conversationState.data, expiresAt: conversationState.expiresAt })
    .from(conversationState)
    .where(eq(conversationState.userId, userId));
  if (!row || (row.expiresAt && row.expiresAt <= now)) {
    return { mode: 'idle', data: {}, expiresAt: null };
  }
  return row;
}

export async function setState(
  db: Database,
  userId: number,
  mode: ConversationMode,
  data: Record<string, unknown> = {},
  expiresAt: Date | null = null,
) {
  await db
    .insert(conversationState)
    .values({ userId, mode, data, expiresAt })
    .onConflictDoUpdate({ target: conversationState.userId, set: { mode, data, expiresAt } });
}

export async function clearState(db: Database, userId: number) {
  await setState(db, userId, 'idle');
}
