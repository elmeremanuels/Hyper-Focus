// Parses Telegram webhook updates into typed events (BOUWPLAN.md, 9.2).
import { z } from 'zod';

export type TelegramContent =
  | { kind: 'text'; text: string }
  | { kind: 'command'; command: string; argument: string }
  | { kind: 'button'; buttonId: string; callbackQueryId: string; title: string }
  | { kind: 'voice'; fileId: string; durationSeconds: number }
  | { kind: 'unsupported' };

export interface TelegramUpdate {
  updateId: number;
  fromUserId: number;
  chatId: number;
  /** The message that was sent, or the message whose button was tapped. */
  messageId: number;
  sentAt: Date;
  content: TelegramContent;
}

const user = z.looseObject({ id: z.number(), first_name: z.string().optional() });
const chat = z.looseObject({ id: z.number(), type: z.string() });

const inlineButton = z.looseObject({ text: z.string(), callback_data: z.string().optional() });

const message = z.looseObject({
  message_id: z.number(),
  from: user.optional(),
  chat,
  date: z.number(),
  text: z.string().optional(),
  voice: z.looseObject({ file_id: z.string(), duration: z.number() }).optional(),
  reply_markup: z.looseObject({ inline_keyboard: z.array(z.array(inlineButton)) }).optional(),
});

const update = z.looseObject({
  update_id: z.number(),
  message: message.optional(),
  callback_query: z
    .looseObject({
      id: z.string(),
      from: user,
      message: message.optional(),
      data: z.string().optional(),
    })
    .optional(),
});

/** Returns undefined for updates the bot ignores (groups, channels, edits, malformed). */
export function parseUpdate(body: unknown): TelegramUpdate | undefined {
  const parsed = update.safeParse(body);
  if (!parsed.success) return undefined;
  const { update_id: updateId, message: msg, callback_query: callback } = parsed.data;

  if (callback) {
    const source = callback.message;
    if (!source || source.chat.type !== 'private' || callback.data === undefined) return undefined;
    const title =
      source.reply_markup?.inline_keyboard
        .flat()
        .find((button) => button.callback_data === callback.data)?.text ?? callback.data;
    return {
      updateId,
      fromUserId: callback.from.id,
      chatId: source.chat.id,
      messageId: source.message_id,
      sentAt: new Date(),
      content: { kind: 'button', buttonId: callback.data, callbackQueryId: callback.id, title },
    };
  }

  if (!msg || !msg.from || msg.chat.type !== 'private') return undefined;

  return {
    updateId,
    fromUserId: msg.from.id,
    chatId: msg.chat.id,
    messageId: msg.message_id,
    sentAt: new Date(msg.date * 1000),
    content: toContent(msg),
  };
}

function toContent(msg: z.infer<typeof message>): TelegramContent {
  if (msg.voice) {
    return { kind: 'voice', fileId: msg.voice.file_id, durationSeconds: msg.voice.duration };
  }
  if (msg.text !== undefined) {
    const command = /^\/([a-z_]+)(?:@\w+)?(?:\s+(.*))?$/is.exec(msg.text.trim());
    if (command) {
      return {
        kind: 'command',
        command: (command[1] ?? '').toLowerCase(),
        argument: (command[2] ?? '').trim(),
      };
    }
    return { kind: 'text', text: msg.text };
  }
  return { kind: 'unsupported' };
}
