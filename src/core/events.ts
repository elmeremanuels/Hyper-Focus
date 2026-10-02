import type { Database } from '../db/client.js';
import { aiUsage, events } from '../db/schema/index.js';
import type { EventName } from '../db/schema/metrics.js';

/** Metadata only, never message content (BOUWPLAN.md, 14). */
export async function recordEvent(
  db: Database,
  userId: number,
  name: EventName,
  props: Record<string, unknown> = {},
) {
  await db.insert(events).values({ userId, name, props });
}

export async function recordAiUsage(
  db: Database,
  record: { userId: number; purpose: string; model: string; inputTokens: number; outputTokens: number },
) {
  await db.insert(aiUsage).values(record);
}
