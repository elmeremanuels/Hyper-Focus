import type { Database } from '../db/client.js';
import { ideas } from '../db/schema/index.js';

export type CaptureSource = 'telegram' | 'voice' | 'email' | 'engine' | 'web' | 'seed';

/** Ideas go to the inbox and never straight into the focus (BOUWPLAN.md, 11.7). */
export async function addIdea(db: Database, userId: number, text: string, source: CaptureSource) {
  const [row] = await db.insert(ideas).values({ userId, text, source }).returning({ id: ideas.id });
  return row;
}
