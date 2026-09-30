import type { MessageStore, StoredMessageType } from '../../core/messages.js';
import type { OutboundChannel, OutboundMessage } from '../../conversation/types.js';
import type { WhatsAppClient } from './client.js';

/** Sends router replies through WhatsApp and stores every outgoing message. */
export class WhatsAppChannel implements OutboundChannel {
  constructor(
    private readonly client: WhatsAppClient,
    private readonly store: MessageStore,
    private readonly userId: number,
  ) {}

  async send(to: string, message: OutboundMessage): Promise<void> {
    let type: StoredMessageType = 'text';
    let result;
    if (message.list && message.list.rows.length > 0) {
      type = 'list';
      result = await this.client.sendList(to, message.text, message.list);
    } else if (message.buttons && message.buttons.length > 0) {
      type = 'button';
      result = await this.client.sendButtons(to, message.text, message.buttons);
    } else {
      result = await this.client.sendText(to, message.text);
    }

    await this.store.recordOutbound({
      userId: this.userId,
      waMessageId: result.id,
      type,
      body: message.text,
    });
  }
}
