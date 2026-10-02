import type { MessageStore } from '../../core/messages.js';
import type { OutboundMessage } from '../../conversation/types.js';
import { actionUrl, createActionToken } from '../actions/links.js';
import { ChannelUnavailableError, type Channel, type ChannelUser, type SendContext } from '../channel.js';
import type { EmailSender } from './send.js';
import { renderMessageMail } from './templates/message.js';

export interface EmailChannelConfig {
  /** Both needed for buttons as action links; without them buttons are left out. */
  actionLinkSecret: string | undefined;
  baseUrl: string | undefined;
  now?: () => Date;
}

export const DEFAULT_SUBJECT = 'Bericht van Hyper&Focus';

export class EmailChannel implements Channel {
  readonly name = 'email' as const;

  constructor(
    private readonly sender: EmailSender,
    private readonly store: MessageStore,
    private readonly config: EmailChannelConfig,
  ) {}

  async send(user: ChannelUser, message: OutboundMessage, context: SendContext = {}): Promise<void> {
    if (!user.email) throw new ChannelUnavailableError('email', 'user has no mail address');
    if (!this.sender.isConfigured()) throw new ChannelUnavailableError('email', 'Brevo not configured');

    const { actionLinkSecret: secret, baseUrl } = this.config;
    const now = this.config.now ?? (() => new Date());
    const linkFor =
      secret && baseUrl
        ? (buttonId: string) => actionUrl(baseUrl, createActionToken(user.id, buttonId, secret, now()))
        : undefined;

    const subject = context.subject ?? DEFAULT_SUBJECT;
    const { text, html } = renderMessageMail(message, linkFor);
    const { messageId } = await this.sender.send({
      to: user.email,
      subject,
      text,
      html,
      ...(context.inReplyTo && { inReplyTo: context.inReplyTo }),
    });

    await this.store.recordOutbound({
      userId: user.id,
      channel: 'email',
      externalId: messageId ?? null,
      type: 'email',
      subject,
      body: message.text,
      deliveryStatus: 'sent',
    });
    await this.store.recordEvent(user.id, 'email_sent', { subject_length: subject.length });
  }
}
