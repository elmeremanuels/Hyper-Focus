import type { MessageRecord, MessageStore } from '../../src/core/messages.js';
import type { LinkableUser, UserStore } from '../../src/core/users.js';

export interface StoredMessage extends MessageRecord {
  direction: 'in' | 'out';
  deliveryStatus?: 'sent' | 'failed';
}

/** In-memory MessageStore with the same unique rule on (channel, externalId) as the database. */
export class MemoryMessageStore implements MessageStore {
  readonly messages: StoredMessage[] = [];
  readonly events: Array<{ userId: number; name: string; props: Record<string, unknown> }> = [];
  readonly lastInbound = new Map<number, Date>();

  async recordInbound(record: MessageRecord & { externalId: string }) {
    const exists = this.messages.some(
      (message) => message.channel === record.channel && message.externalId === record.externalId,
    );
    if (exists) return false;
    this.messages.push({ ...record, direction: 'in' });
    return true;
  }

  async recordOutbound(record: MessageRecord & { deliveryStatus: 'sent' | 'failed' }) {
    this.messages.push({ ...record, direction: 'out' });
  }

  async touchLastInbound(userId: number, at: Date) {
    this.lastInbound.set(userId, at);
  }

  async recordEvent(userId: number, name: string, props: Record<string, unknown> = {}) {
    this.events.push({ userId, name, props });
  }

  inbound() {
    return this.messages.filter((message) => message.direction === 'in');
  }

  outbound() {
    return this.messages.filter((message) => message.direction === 'out');
  }
}

export class MemoryUserStore implements UserStore {
  constructor(readonly users: LinkableUser[]) {}

  async findById(id: number) {
    return this.users.find((user) => user.id === id);
  }

  async findByTelegramUserId(telegramUserId: number) {
    return this.users.find((user) => user.telegramUserId === telegramUserId);
  }

  async findByEmail(email: string) {
    return this.users.find((user) => user.email === email.toLowerCase());
  }

  async linkTelegram(userId: number, telegramUserId: number, chatId: number, at: Date) {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (user) Object.assign(user, { telegramUserId, telegramChatId: chatId, telegramLinkedAt: at });
  }
}

export const SAM_TELEGRAM_ID = 111222333;

export function sam(overrides: Partial<LinkableUser> = {}): LinkableUser {
  return {
    id: 1,
    name: 'Sam',
    email: 'sam@voorbeeld.invalid',
    telegramUserId: SAM_TELEGRAM_ID,
    telegramChatId: SAM_TELEGRAM_ID,
    telegramLinkedAt: new Date('2026-09-30T08:00:00Z'),
    preferredChannel: 'telegram',
    ...overrides,
  };
}

/** Fake Telegram Bot API: records every call and returns increasing message ids. */
export function fakeTelegramFetch() {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  let messageId = 100;
  let failWith: { code: number; description: string } | undefined;

  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const method = String(url).split('/').pop()!;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ method, body });
    if (failWith && method === 'sendMessage') {
      return new Response(
        JSON.stringify({ ok: false, error_code: failWith.code, description: failWith.description }),
        { status: failWith.code },
      );
    }
    const result = method === 'sendMessage' ? { message_id: ++messageId } : true;
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  };

  return {
    fetchImpl: fetchImpl as typeof fetch,
    calls,
    sent: () => calls.filter((call) => call.method === 'sendMessage'),
    failSendWith(code: number, description: string) {
      failWith = { code, description };
    },
  };
}
