import type { MessageStore } from '../../core/messages.js';
import type { OutboundMessage } from '../../conversation/types.js';
import { ChannelUnavailableError, type Channel, type ChannelUser } from '../channel.js';
import { TelegramApiError, type TelegramClient } from './client.js';
import { splitText, toInlineKeyboard } from './keyboard.js';

/** Sends messages through the Telegram bot and stores every outgoing message. */
export class TelegramChannel implements Channel {
  readonly name = 'telegram' as const;

  constructor(
    private readonly client: TelegramClient,
    private readonly store: MessageStore,
  ) {}

  async send(user: ChannelUser, message: OutboundMessage): Promise<void> {
    const chatId = user.telegramChatId;
    if (chatId === null) {
      throw new ChannelUnavailableError('telegram', 'user has not linked Telegram');
    }

    const keyboard = toInlineKeyboard(message);
    const parts = splitText(message.text);
    const type = keyboard ? 'button' : 'text';

    try {
      for (const [index, part] of parts.entries()) {
        // Buttons go under the last part.
        const markup = index === parts.length - 1 ? keyboard : undefined;
        const { messageId } = await this.client.sendMessage(chatId, part, markup);
        await this.store.recordOutbound({
          userId: user.id,
          channel: 'telegram',
          externalId: `m:${chatId}:${messageId}`,
          type,
          body: part,
          deliveryStatus: 'sent',
        });
      }
      for (const file of message.attachments ?? []) {
        await this.client.sendDocument(chatId, file.filename, file.mimeType, file.content);
      }
    } catch (error) {
      if (error instanceof TelegramApiError) {
        await this.store.recordOutbound({
          userId: user.id,
          channel: 'telegram',
          externalId: null,
          type,
          body: message.text,
          deliveryStatus: 'failed',
        });
        if (error.chatUnreachable) {
          throw new ChannelUnavailableError('telegram', error.description);
        }
      }
      throw error;
    }
  }
}
