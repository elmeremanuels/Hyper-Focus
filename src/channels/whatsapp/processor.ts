// Handles a verified webhook payload (BOUWPLAN.md, 9.3): allow-list, idempotency,
// 24-hour window bookkeeping, routing and status updates.
import type { MessageStore, StoredMessageType } from '../../core/messages.js';
import type { Router } from '../../conversation/router.js';
import type { InboundMessage, OutboundChannel, OutboundMessage } from '../../conversation/types.js';
import { parseWebhook, type InboundWhatsAppMessage } from './inbound.js';

export interface ProcessorDeps {
  store: MessageStore;
  router: Router;
  allowedNumbers: readonly string[];
  channelFor(userId: number): OutboundChannel;
  log?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export interface ProcessResult {
  processed: number;
  duplicates: number;
  ignored: number;
  statuses: number;
}

const AUDIO_REPLY: OutboundMessage = { text: 'Spraakberichten lees ik nog niet. Wil je het typen?' };
const UNSUPPORTED_REPLY: OutboundMessage = {
  text: 'Dit soort bericht lees ik nog niet. Stuur tekst of tik op een knop.',
};

export function createWebhookProcessor(deps: ProcessorDeps) {
  const log = deps.log ?? console;
  const allowed = new Set(deps.allowedNumbers);

  return async function processPayload(body: unknown): Promise<ProcessResult> {
    const parsed = parseWebhook(body);
    const result: ProcessResult = { processed: 0, duplicates: 0, ignored: 0, statuses: 0 };

    for (const status of parsed.statuses) {
      await deps.store.updateDeliveryStatus(status.waMessageId, status.status, status.at);
      result.statuses += 1;
    }

    for (const message of parsed.messages) {
      try {
        const outcome = await handleMessage(message);
        result[outcome] += 1;
      } catch (error) {
        log.error(`Failed to handle WhatsApp message ${message.waMessageId}:`, error);
      }
    }

    return result;
  };

  async function handleMessage(
    message: InboundWhatsAppMessage,
  ): Promise<'processed' | 'duplicates' | 'ignored'> {
    if (!allowed.has(message.from)) {
      log.warn(`Ignored WhatsApp message from unknown number ${maskPhone(message.from)}`);
      return 'ignored';
    }

    const user = await deps.store.findUserByPhone(message.from);
    if (!user) {
      log.warn(`Ignored WhatsApp message: no user for ${maskPhone(message.from)}`);
      return 'ignored';
    }

    const isNew = await deps.store.recordInbound({
      userId: user.id,
      waMessageId: message.waMessageId,
      type: storedType(message),
      body: bodyOf(message),
    });
    if (!isNew) {
      return 'duplicates';
    }

    await deps.store.touchLastInbound(user.id, message.sentAt);
    await deps.store.recordEvent(user.id, 'inbound_message', { type: message.content.kind });

    const channel = deps.channelFor(user.id);
    for (const reply of await route(message)) {
      await channel.send(message.from, reply);
    }
    return 'processed';
  }

  async function route(message: InboundWhatsAppMessage): Promise<OutboundMessage[]> {
    const { content, from } = message;
    let inbound: InboundMessage;
    switch (content.kind) {
      case 'text':
        inbound = { kind: 'text', from, text: content.text };
        break;
      case 'button':
        inbound = { kind: 'button', from, buttonId: content.buttonId, title: content.title };
        break;
      case 'audio':
        // Transcription follows in step 1.6.
        return [AUDIO_REPLY];
      case 'unsupported':
        return [UNSUPPORTED_REPLY];
    }
    return deps.router(inbound);
  }
}

function storedType(message: InboundWhatsAppMessage): StoredMessageType {
  switch (message.content.kind) {
    case 'text':
    case 'unsupported':
      return 'text';
    case 'button':
      return message.content.via === 'list' ? 'list' : 'button';
    case 'audio':
      return 'audio';
  }
}

function bodyOf(message: InboundWhatsAppMessage): string | null {
  switch (message.content.kind) {
    case 'text':
      return message.content.text;
    case 'button':
      return message.content.buttonId;
    default:
      return null;
  }
}

/** Keeps phone numbers out of logs: +31612345678 → +316*****678. */
export function maskPhone(phone: string): string {
  return phone.length <= 7 ? '***' : `${phone.slice(0, 4)}${'*'.repeat(phone.length - 7)}${phone.slice(-3)}`;
}
