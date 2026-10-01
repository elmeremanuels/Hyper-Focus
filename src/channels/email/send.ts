// Harvested from Publicato-personal server/services/sendgridService.ts (sending only).
// Changed: tenant branding, storage and templates removed; sender, Reply-To and
// threading headers from config (BOUWPLAN.md, 9.3).
import sgMail from '@sendgrid/mail';

export interface EmailSenderConfig {
  apiKey: string | undefined;
  from: string | undefined;
  replyTo: string | undefined;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Message-ID of the mail this answers. */
  inReplyTo?: string;
}

export interface MailTransport {
  setApiKey(apiKey: string): void;
  send(message: sgMail.MailDataRequired): Promise<[{ headers: Record<string, unknown> }, unknown]>;
}

export class EmailSender {
  constructor(
    private readonly config: EmailSenderConfig,
    private readonly transport: MailTransport = sgMail as unknown as MailTransport,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.apiKey && this.config.from);
  }

  /** Returns SendGrid's message id when it reports one. */
  async send(message: EmailMessage): Promise<{ messageId: string | undefined }> {
    const { apiKey, from, replyTo } = this.config;
    if (!apiKey || !from) {
      throw new Error('SendGrid is not configured (SENDGRID_API_KEY, EMAIL_FROM)');
    }

    this.transport.setApiKey(apiKey);
    const [response] = await this.transport.send({
      to: message.to,
      from: { email: from, name: 'Hyper&Focus' },
      ...(replyTo && { replyTo }),
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.inReplyTo && {
        headers: { 'In-Reply-To': message.inReplyTo, References: message.inReplyTo },
      }),
    });

    const messageId = response.headers['x-message-id'];
    return { messageId: typeof messageId === 'string' ? messageId : undefined };
  }
}
