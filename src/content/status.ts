// Content module (step C3): did Buffer actually post it? Once an hour the worker asks Buffer about
// scheduled posts whose moment has passed. A failure goes to the user with Buffer's reason.
import { and, eq, isNotNull, lt } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { clientChannels, clients, contentPosts, users } from '../db/schema/index.js';
import { BufferError } from '../integrations/buffer/client.js';
import { CONTENT_TEXTS } from '../texts/content.nl.js';
import { bufferForKey, describeSlot, type ContentDeps } from './posts.js';

/** Buffer needs a moment to post; asking right away would show "sending". */
const GRACE_MS = 10 * 60_000;
/** After this long without an answer, a post counts as failed. */
const GIVE_UP_MS = 24 * 3_600_000;

export interface StatusResult {
  sent: number;
  failed: number;
}

export async function checkScheduledPosts(
  db: Database,
  deps: ContentDeps | undefined,
  now: Date,
  notify: (userId: number, text: string) => Promise<void>,
): Promise<StatusResult> {
  const rows = await db
    .select({ post: contentPosts, key: clients.bufferApiKeyEnc, client: clients.name, channel: clientChannels.name, timezone: users.timezone })
    .from(contentPosts)
    .innerJoin(clients, eq(clients.id, contentPosts.clientId))
    .innerJoin(clientChannels, eq(clientChannels.id, contentPosts.channelId))
    .innerJoin(users, eq(users.id, contentPosts.userId))
    .where(and(eq(contentPosts.status, 'scheduled'), isNotNull(contentPosts.bufferPostId), lt(contentPosts.dueAt, new Date(now.getTime() - GRACE_MS))));

  const result: StatusResult = { sent: 0, failed: 0 };
  for (const row of rows) {
    const { post } = row;
    const buffer = bufferForKey(deps, row.key);
    if (!buffer || !post.bufferPostId) continue;
    let status: string;
    let error: string | null;
    try {
      ({ status, error } = await buffer.getPost(post.bufferPostId));
    } catch (e) {
      // Buffer cannot be reached or the key no longer works: try again next hour.
      if (!(e instanceof BufferError)) console.error(`Buffer status of post ${post.id} failed:`, e);
      continue;
    }
    const where = eq(contentPosts.id, post.id);
    if (status === 'sent') {
      await db.update(contentPosts).set({ status: 'sent' }).where(where);
      result.sent++;
      continue;
    }
    const stuck = post.dueAt && now.getTime() - post.dueAt.getTime() > GIVE_UP_MS;
    if (status === 'error' || stuck) {
      const reason = error ?? (stuck ? 'Buffer heeft de post na een dag nog niet geplaatst' : 'onbekend');
      await db.update(contentPosts).set({ status: 'failed', error: reason.slice(0, 500) }).where(where);
      result.failed++;
      const when = post.dueAt ? describeSlot(row.timezone, post.dueAt) : '';
      await notify(post.userId, CONTENT_TEXTS.notPosted(row.client, row.channel, when, reason)).catch((e: unknown) => console.error('Notify failed:', e));
    }
  }
  return result;
}
