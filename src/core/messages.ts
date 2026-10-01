import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { events, messages, users } from '../db/schema/index.js';
import type { EventName } from '../db/schema/metrics.js';

export type MessageChannel = 'telegram' | 'email' | 'web';
export type StoredMessageType = 'text' | 'button' | 'audio' | 'email' | 'action_link';

export interface MessageRecord {
  userId: number;
  channel: MessageChannel;
  externalId: string | null;
  type: StoredMessageType;
  body: string | null;
  subject?: string | null;
}

export interface MessageStore {
  /**
   * Stores an inbound message. Returns false when (channel, externalId) was already
   * stored: a duplicate delivery or an action link that was used before.
   */
  recordInbound(record: MessageRecord & { externalId: string }): Promise<boolean>;
  recordOutbound(record: MessageRecord & { deliveryStatus: 'sent' | 'failed' }): Promise<void>;
  touchLastInbound(userId: number, at: Date): Promise<void>;
  recordEvent(userId: number, name: EventName, props?: Record<string, unknown>): Promise<void>;
}

export function createDbMessageStore(db: Database): MessageStore {
  return {
    async recordInbound(record) {
      const inserted = await db
        .insert(messages)
        .values({ ...record, subject: record.subject ?? null, direction: 'in' })
        .onConflictDoNothing({ target: [messages.channel, messages.externalId] })
        .returning({ id: messages.id });
      return inserted.length > 0;
    },

    async recordOutbound(record) {
      await db
        .insert(messages)
        .values({ ...record, subject: record.subject ?? null, direction: 'out' });
    },

    async touchLastInbound(userId, at) {
      await db.update(users).set({ lastInboundAt: at }).where(eq(users.id, userId));
    },

    async recordEvent(userId, name, props = {}) {
      await db.insert(events).values({ userId, name, props });
    },
  };
}
