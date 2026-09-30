import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { events, messages, users } from '../db/schema/index.js';
import type { EventName } from '../db/schema/metrics.js';
import type { DeliveryStatus } from '../channels/whatsapp/inbound.js';

export type StoredMessageType = 'text' | 'button' | 'list' | 'audio' | 'template';

export interface MessageRecord {
  userId: number;
  waMessageId: string | undefined;
  type: StoredMessageType;
  body: string | null;
}

export interface MessageStore {
  findUserByPhone(phone: string): Promise<{ id: number; name: string } | undefined>;
  /** Returns false when the message id was already stored (duplicate delivery). */
  recordInbound(record: MessageRecord & { waMessageId: string }): Promise<boolean>;
  recordOutbound(record: MessageRecord): Promise<void>;
  touchLastInbound(userId: number, at: Date): Promise<void>;
  updateDeliveryStatus(waMessageId: string, status: DeliveryStatus, at: Date): Promise<void>;
  recordEvent(userId: number, name: EventName, props?: Record<string, unknown>): Promise<void>;
}

// A status only moves forward: sent → delivered → read. `failed` can follow sent or delivered.
const PREVIOUS_STATUSES: Record<DeliveryStatus, DeliveryStatus[]> = {
  sent: [],
  delivered: ['sent'],
  read: ['sent', 'delivered'],
  failed: ['sent', 'delivered'],
};

export function createDbMessageStore(db: Database): MessageStore {
  return {
    async findUserByPhone(phone) {
      const [user] = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.phoneE164, phone));
      return user;
    },

    async recordInbound(record) {
      const inserted = await db
        .insert(messages)
        .values({ ...record, direction: 'in', channel: 'whatsapp' })
        .onConflictDoNothing({ target: messages.waMessageId })
        .returning({ id: messages.id });
      return inserted.length > 0;
    },

    async recordOutbound(record) {
      await db.insert(messages).values({
        ...record,
        waMessageId: record.waMessageId ?? null,
        direction: 'out',
        channel: 'whatsapp',
        deliveryStatus: record.waMessageId ? 'sent' : null,
        deliveryStatusAt: record.waMessageId ? new Date() : null,
      });
    },

    async touchLastInbound(userId, at) {
      await db.update(users).set({ lastInboundAt: at }).where(eq(users.id, userId));
    },

    async updateDeliveryStatus(waMessageId, status, at) {
      const previous = PREVIOUS_STATUSES[status];
      await db
        .update(messages)
        .set({ deliveryStatus: status, deliveryStatusAt: at })
        .where(
          and(
            eq(messages.waMessageId, waMessageId),
            eq(messages.direction, 'out'),
            previous.length > 0
              ? or(isNull(messages.deliveryStatus), inArray(messages.deliveryStatus, previous))
              : isNull(messages.deliveryStatus),
          ),
        );
    },

    async recordEvent(userId, name, props = {}) {
      await db.insert(events).values({ userId, name, props });
    },
  };
}
