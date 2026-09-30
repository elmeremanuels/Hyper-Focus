import type { MessageRecord, MessageStore } from '../../src/core/messages.js';
import type { DeliveryStatus } from '../../src/channels/whatsapp/inbound.js';

interface StoredMessage extends MessageRecord {
  direction: 'in' | 'out';
  deliveryStatus?: DeliveryStatus;
}

/** In-memory MessageStore with the same unique rule on waMessageId as the database. */
export class MemoryMessageStore implements MessageStore {
  readonly messages: StoredMessage[] = [];
  readonly events: Array<{ userId: number; name: string; props: Record<string, unknown> }> = [];
  readonly lastInbound = new Map<number, Date>();

  constructor(private readonly users: Record<string, { id: number; name: string }>) {}

  async findUserByPhone(phone: string) {
    return this.users[phone];
  }

  async recordInbound(record: MessageRecord & { waMessageId: string }) {
    if (this.messages.some((message) => message.waMessageId === record.waMessageId)) {
      return false;
    }
    this.messages.push({ ...record, direction: 'in' });
    return true;
  }

  async recordOutbound(record: MessageRecord) {
    this.messages.push({ ...record, direction: 'out', deliveryStatus: 'sent' });
  }

  async touchLastInbound(userId: number, at: Date) {
    this.lastInbound.set(userId, at);
  }

  async updateDeliveryStatus(waMessageId: string, status: DeliveryStatus) {
    for (const message of this.messages) {
      if (message.waMessageId === waMessageId && message.direction === 'out') {
        message.deliveryStatus = status;
      }
    }
  }

  async recordEvent(userId: number, name: string, props: Record<string, unknown> = {}) {
    this.events.push({ userId, name, props });
  }
}
