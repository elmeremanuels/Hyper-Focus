// Sends mail through the Brevo transactional API (BOUWPLAN.md, 9.3):
// POST https://api.brevo.com/v3/smtp/email with the api-key header.

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
  attachments?: Array<{ filename: string; content: string }>;
}

export class EmailSendError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`Brevo send failed (${status}): ${detail}`);
    this.name = 'EmailSendError';
  }
}

type FetchLike = typeof fetch;

export const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

export class EmailSender {
  constructor(
    private readonly config: EmailSenderConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.apiKey && this.config.from);
  }

  /** Returns Brevo's message id when it reports one. */
  async send(message: EmailMessage): Promise<{ messageId: string | undefined }> {
    const { apiKey, from, replyTo } = this.config;
    if (!apiKey || !from) {
      throw new Error('Brevo is not configured (BREVO_API_KEY, EMAIL_FROM)');
    }

    const response = await this.fetchImpl(BREVO_SEND_URL, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'Hyper&Focus', email: from },
        to: [{ email: message.to }],
        ...(replyTo && { replyTo: { email: replyTo } }),
        subject: message.subject,
        textContent: message.text,
        htmlContent: message.html,
        ...(message.attachments?.length && {
          attachment: message.attachments.map((file) => ({
            name: file.filename,
            content: Buffer.from(file.content, 'utf8').toString('base64'),
          })),
        }),
        ...(message.inReplyTo && {
          headers: { 'In-Reply-To': message.inReplyTo, References: message.inReplyTo },
        }),
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as { messageId?: unknown; message?: unknown };
    if (!response.ok) {
      throw new EmailSendError(response.status, typeof payload.message === 'string' ? payload.message : 'Unknown error');
    }
    return { messageId: typeof payload.messageId === 'string' ? payload.messageId : undefined };
  }
}
