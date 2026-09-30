// Parses Meta webhook payloads into typed events (BOUWPLAN.md, 9.3–9.4).
import { z } from 'zod';

export type InboundContent =
  | { kind: 'text'; text: string }
  | { kind: 'button'; buttonId: string; title: string; via: 'button' | 'list' | 'template' }
  | { kind: 'audio'; mediaId: string; mimeType: string | undefined }
  | { kind: 'unsupported'; type: string };

export interface InboundWhatsAppMessage {
  waMessageId: string;
  /** E.164, e.g. +31612345678. */
  from: string;
  sentAt: Date;
  content: InboundContent;
}

export type DeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface StatusUpdate {
  waMessageId: string;
  status: DeliveryStatus;
  at: Date;
}

export interface ParsedWebhook {
  messages: InboundWhatsAppMessage[];
  statuses: StatusUpdate[];
}

const messageSchema = z.looseObject({
  id: z.string(),
  from: z.string(),
  timestamp: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  interactive: z
    .looseObject({
      type: z.string(),
      button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
      list_reply: z.looseObject({ id: z.string(), title: z.string() }).optional(),
    })
    .optional(),
  // Quick-reply button on a template message.
  button: z.object({ payload: z.string(), text: z.string() }).optional(),
  audio: z.looseObject({ id: z.string(), mime_type: z.string().optional() }).optional(),
});

const statusSchema = z.looseObject({
  id: z.string(),
  status: z.string(),
  timestamp: z.string(),
});

const payloadSchema = z.looseObject({
  object: z.string(),
  entry: z.array(
    z.looseObject({
      changes: z.array(
        z.looseObject({
          field: z.string(),
          value: z.looseObject({
            messages: z.array(z.unknown()).optional(),
            statuses: z.array(z.unknown()).optional(),
          }),
        }),
      ),
    }),
  ),
});

const DELIVERY_STATUSES: readonly string[] = ['sent', 'delivered', 'read', 'failed'];

/** Meta sends numbers without a plus sign (e.g. 316…); normalize to E.164. */
export function normalizeWaNumber(value: string): string {
  const digits = value.replace(/\D/g, '');
  return `+${digits}`;
}

export function parseWebhook(body: unknown): ParsedWebhook {
  const parsed = payloadSchema.safeParse(body);
  const result: ParsedWebhook = { messages: [], statuses: [] };
  if (!parsed.success || parsed.data.object !== 'whatsapp_business_account') {
    return result;
  }

  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue;

      for (const raw of change.value.messages ?? []) {
        const message = messageSchema.safeParse(raw);
        if (!message.success) continue;
        result.messages.push({
          waMessageId: message.data.id,
          from: normalizeWaNumber(message.data.from),
          sentAt: new Date(Number(message.data.timestamp) * 1000),
          content: toContent(message.data),
        });
      }

      for (const raw of change.value.statuses ?? []) {
        const status = statusSchema.safeParse(raw);
        if (!status.success || !DELIVERY_STATUSES.includes(status.data.status)) continue;
        result.statuses.push({
          waMessageId: status.data.id,
          status: status.data.status as DeliveryStatus,
          at: new Date(Number(status.data.timestamp) * 1000),
        });
      }
    }
  }

  return result;
}

function toContent(message: z.infer<typeof messageSchema>): InboundContent {
  switch (message.type) {
    case 'text':
      return message.text ? { kind: 'text', text: message.text.body } : unsupported(message.type);
    case 'interactive': {
      const buttonReply = message.interactive?.button_reply;
      if (buttonReply) {
        return { kind: 'button', buttonId: buttonReply.id, title: buttonReply.title, via: 'button' };
      }
      const listReply = message.interactive?.list_reply;
      if (listReply) {
        return { kind: 'button', buttonId: listReply.id, title: listReply.title, via: 'list' };
      }
      return unsupported(message.type);
    }
    case 'button':
      return message.button
        ? {
            kind: 'button',
            buttonId: message.button.payload,
            title: message.button.text,
            via: 'template',
          }
        : unsupported(message.type);
    case 'audio':
      return message.audio
        ? { kind: 'audio', mediaId: message.audio.id, mimeType: message.audio.mime_type }
        : unsupported(message.type);
    default:
      return unsupported(message.type);
  }
}

function unsupported(type: string): InboundContent {
  return { kind: 'unsupported', type };
}
