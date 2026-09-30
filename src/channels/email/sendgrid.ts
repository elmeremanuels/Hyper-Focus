// Harvested from Publicato-personal server/services/sendgridService.ts (sending only).
// Changed: tenant branding, storage and templates removed; key and sender from env.
// The weekly overview template follows in step 1.7.
import sgMail from '@sendgrid/mail';

export interface SendGridConfig {
  apiKey: string | undefined;
  from: string | undefined;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface MailTransport {
  setApiKey(apiKey: string): void;
  send(message: sgMail.MailDataRequired): Promise<[{ headers: Record<string, unknown> }, unknown]>;
}

export class SendGridMailer {
  constructor(
    private readonly config: SendGridConfig,
    private readonly transport: MailTransport = sgMail as unknown as MailTransport,
  ) {}

  async send(message: EmailMessage): Promise<SendResult> {
    const { apiKey, from } = this.config;
    if (!apiKey || !from) {
      return { success: false, error: 'SendGrid is not configured (SENDGRID_API_KEY, EMAIL_FROM)' };
    }

    try {
      this.transport.setApiKey(apiKey);
      const [response] = await this.transport.send({
        to: message.to,
        from: { email: from, name: 'Hyper&Focus' },
        subject: message.subject,
        text: message.text,
        ...(message.html !== undefined && { html: message.html }),
      });

      const messageId = response.headers['x-message-id'];
      return {
        success: true,
        ...(typeof messageId === 'string' && { messageId }),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send email',
      };
    }
  }
}
