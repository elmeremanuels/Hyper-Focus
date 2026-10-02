// Handles a verified Telegram update (BOUWPLAN.md, 9.2): allow-list, linking via /start,
// idempotency, removing tapped keyboards, routing and replies.
import type { MessageStore, StoredMessageType } from '../../core/messages.js';
import type { LinkableUser, UserStore } from '../../core/users.js';
import type { Router } from '../../conversation/router.js';
import type { InboundMessage, OutboundMessage } from '../../conversation/types.js';
import { mask } from '../../lib/secrets.js';
import type { Delivery } from '../channel.js';
import type { TelegramClient } from './client.js';
import { verifyLinkCode } from './link.js';
import { parseUpdate, type TelegramUpdate } from './updates.js';

export interface TelegramProcessorDeps {
  client: TelegramClient;
  users: UserStore;
  messages: MessageStore;
  delivery: Delivery;
  router: Router;
  allowedUserIds: readonly number[];
  linkSecret: string | undefined;
  log?: Pick<Console, 'info' | 'warn' | 'error'>;
  now?: () => Date;
}

export type TelegramOutcome = 'processed' | 'duplicate' | 'ignored' | 'linked';

export const TEXTS = {
  closed: 'Deze bot is nog besloten.',
  notLinked: 'Je Telegram is nog niet gekoppeld. Open de koppellink die je kreeg.',
  linkInvalid: 'Deze koppellink is verlopen of al gebruikt. Vraag een nieuwe aan.',
  linkTaken: 'Dit Telegram-account is al aan een ander account gekoppeld.',
  linked: 'Gekoppeld. Vanaf nu stuur ik je berichten hier. Zal ik je focus voor vandaag laten zien?',
  voice: 'Spraakberichten lees ik nog niet. Wil je het typen?',
  unsupported: 'Dit soort bericht lees ik nog niet. Stuur tekst of tik op een knop.',
} as const;

// Bot commands map to the same words a user could type (BOUWPLAN.md, 9.1).
const COMMAND_TEXT: Record<string, string> = {
  start: 'hoi',
  vandaag: 'vandaag',
  pauze: 'pauze',
  parkeerplaats: 'parkeerplaats',
  help: 'help',
};

export function createTelegramProcessor(deps: TelegramProcessorDeps) {
  const log = deps.log ?? console;
  const now = deps.now ?? (() => new Date());
  const allowed = new Set(deps.allowedUserIds);

  return async function processUpdate(body: unknown): Promise<TelegramOutcome> {
    const update = parseUpdate(body);
    if (!update) return 'ignored';

    if (update.content.kind === 'button') {
      // Answer within seconds so the client stops its spinner.
      const { callbackQueryId } = update.content;
      await quietly(() => deps.client.answerCallbackQuery(callbackQueryId));
    }

    if (!allowed.has(update.fromUserId)) {
      log.warn(`Ignored Telegram update from unknown user ${mask(update.fromUserId)}`);
      await quietly(() => deps.client.sendMessage(update.chatId, TEXTS.closed));
      return 'ignored';
    }

    if (update.content.kind === 'command' && update.content.command === 'start' && update.content.argument) {
      return link(update, update.content.argument);
    }

    const user = await deps.users.findByTelegramUserId(update.fromUserId);
    if (!user) {
      await quietly(() => deps.client.sendMessage(update.chatId, TEXTS.notLinked));
      return 'ignored';
    }

    // A tapped button counts once per message: retries and double taps share this id.
    const externalId =
      update.content.kind === 'button'
        ? `cb:${update.chatId}:${update.messageId}`
        : `u:${update.updateId}`;
    const isNew = await deps.messages.recordInbound({
      userId: user.id,
      channel: 'telegram',
      externalId,
      type: storedType(update),
      body: bodyOf(update),
    });

    if (update.content.kind === 'button') {
      await quietly(() => deps.client.removeKeyboard(update.chatId, update.messageId));
    }
    if (!isNew) return 'duplicate';

    await deps.messages.touchLastInbound(user.id, update.sentAt);
    await deps.messages.recordEvent(user.id, 'inbound_message', {
      channel: 'telegram',
      type: update.content.kind,
    });

    for (const reply of await route(update, user)) {
      await deps.delivery.send(withChat(user, update.chatId), reply, { via: 'telegram' });
    }
    return 'processed';
  };

  async function link(update: TelegramUpdate, code: string): Promise<TelegramOutcome> {
    const verified = deps.linkSecret ? verifyLinkCode(code, deps.linkSecret, now()) : undefined;
    const user = verified ? await deps.users.findById(verified.userId) : undefined;

    if (!verified || !user || (user.telegramLinkedAt && user.telegramLinkedAt >= verified.issuedAt)) {
      await quietly(() => deps.client.sendMessage(update.chatId, TEXTS.linkInvalid));
      return 'ignored';
    }

    const owner = await deps.users.findByTelegramUserId(update.fromUserId);
    if (owner && owner.id !== user.id) {
      await quietly(() => deps.client.sendMessage(update.chatId, TEXTS.linkTaken));
      return 'ignored';
    }

    const linkedAt = now();
    await deps.users.linkTelegram(user.id, update.fromUserId, update.chatId, linkedAt);
    await deps.messages.recordInbound({
      userId: user.id,
      channel: 'telegram',
      externalId: `u:${update.updateId}`,
      type: 'text',
      body: '/start',
    });
    await deps.messages.touchLastInbound(user.id, update.sentAt);
    log.info(`Linked Telegram user ${mask(update.fromUserId)} to user ${user.id}`);

    await deps.delivery.send(
      { ...user, telegramChatId: update.chatId },
      { text: TEXTS.linked, buttons: [{ id: 'f:show', title: 'Laat zien' }] },
      { via: 'telegram' },
    );
    return 'linked';
  }

  async function route(update: TelegramUpdate, user: LinkableUser): Promise<OutboundMessage[]> {
    const { content } = update;
    let inbound: InboundMessage;
    switch (content.kind) {
      case 'text':
        inbound = { kind: 'text', userId: user.id, text: content.text, source: 'telegram' };
        break;
      case 'command':
        inbound = {
          kind: 'text',
          userId: user.id,
          text: COMMAND_TEXT[content.command] ?? content.command,
          source: 'telegram',
        };
        break;
      case 'button':
        inbound = {
          kind: 'button',
          userId: user.id,
          buttonId: content.buttonId,
          title: content.title,
          source: 'telegram',
        };
        break;
      case 'voice':
        // Transcription follows in step 1.6.
        return [{ text: TEXTS.voice }];
      case 'unsupported':
        return [{ text: TEXTS.unsupported }];
    }
    return deps.router(inbound);
  }

  async function quietly(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (error) {
      log.error('Telegram call failed:', error);
    }
  }
}

function withChat(user: LinkableUser, chatId: number): LinkableUser {
  return user.telegramChatId === chatId ? user : { ...user, telegramChatId: chatId };
}

function storedType(update: TelegramUpdate): StoredMessageType {
  switch (update.content.kind) {
    case 'button':
      return 'button';
    case 'voice':
      return 'audio';
    default:
      return 'text';
  }
}

function bodyOf(update: TelegramUpdate): string | null {
  switch (update.content.kind) {
    case 'text':
      return update.content.text;
    case 'command':
      return `/${update.content.command}`;
    case 'button':
      return update.content.buttonId;
    default:
      return null;
  }
}
