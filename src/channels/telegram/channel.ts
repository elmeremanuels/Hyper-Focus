import type { MessageStore } from '../../core/messages.js';
import type { OutboundMessage } from '../../conversation/types.js';
import { ChannelUnavailableError, type Channel, type ChannelUser, type SendContext } from '../channel.js';
import { TelegramApiError, type TelegramClient } from './client.js';
import { splitText, toInlineKeyboard } from './keyboard.js';

/** Telegram's limit for a photo caption. */
const CAPTION_MAX = 1024;

/** Sends messages through the Telegram bot and stores every outgoing message. */
export class TelegramChannel implements Channel {
  readonly name = 'telegram' as const;

  constructor(
    private readonly client: TelegramClient,
    private readonly store: MessageStore,
  ) {}

  async send(user: ChannelUser, message: OutboundMessage, context: SendContext = {}): Promise<void> {
    const chatId = user.telegramChatId;
    if (chatId === null) {
      throw new ChannelUnavailableError('telegram', 'user has not linked Telegram');
    }

    const keyboard = toInlineKeyboard(message);
    const type = keyboard ? 'button' : 'text';

    try {
      // A photo first (step C4): with the text as caption when it fits, else the text after it.
      let text = message.text;
      if (message.photo) {
        const fits = text.length <= CAPTION_MAX;
        try {
          const { messageId } = await this.client.sendPhoto(chatId, message.photo, fits ? text : undefined, fits ? keyboard : undefined, { silent: Boolean(context.silent) });
          await this.store.recordOutbound({ userId: user.id, channel: 'telegram', externalId: `m:${chatId}:${messageId}`, type, body: fits ? text : `[foto] ${message.photo}`, deliveryStatus: 'sent' });
          if (fits) return;
        } catch (error) {
          // Telegram could not fetch the image: the link goes in the text instead.
          if (!(error instanceof TelegramApiError) || error.chatUnreachable) throw error;
          text = `${text}\n\nBeeld: ${message.photo}`;
        }
      }
      const parts = splitText(text);
      for (const [index, part] of parts.entries()) {
        // Buttons go under the last part.
        const markup = index === parts.length - 1 ? keyboard : undefined;
        const { messageId } = await this.client.sendMessage(chatId, part, markup, { silent: Boolean(context.silent) });
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
        await this.client.sendDocument(chatId, file.filename, file.mimeType, file.content, { silent: Boolean(context.silent) });
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
