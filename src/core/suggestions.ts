import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { suggestions } from '../db/schema/index.js';
import { recordEvent } from './events.js';

export type SuggestionStatus = 'new' | 'in_progress' | 'done' | 'parked' | 'skipped' | 'not_relevant';

export async function listOpenSuggestions(db: Database, userId: number, limit = 3) {
  return db
    .select({ id: suggestions.id, title: suggestions.title, lens: suggestions.lens, status: suggestions.status })
    .from(suggestions)
    .where(and(eq(suggestions.userId, userId), inArray(suggestions.status, ['new', 'in_progress', 'parked'])))
    .limit(limit);
}

export async function setSuggestionStatus(
  db: Database,
  userId: number,
  suggestionId: number,
  status: SuggestionStatus,
  reason: string | null,
  now: Date = new Date(),
): Promise<boolean> {
  const updated = await db
    .update(suggestions)
    .set({ status, statusReason: reason, respondedAt: now })
    .where(and(eq(suggestions.userId, userId), eq(suggestions.id, suggestionId)))
    .returning({ id: suggestions.id });
  if (updated.length === 0) return false;
  await recordEvent(db, userId, 'suggestion_status_changed', { status });
  return true;
}
