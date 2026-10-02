// Brevo Inbound Parsing: POST /webhooks/mail/{EMAIL_INBOUND_SECRET} (BOUWPLAN.md, 9.3).
// A wrong path gives 404. Brevo posts JSON with an `items` array, one entry per mail.
// Attachments are ignored and never stored.
import crypto from 'node:crypto';
import express, { Router } from 'express';
import { z } from 'zod';
import { safeEqual } from '../../lib/secrets.js';

const mailbox = z.looseObject({ Name: z.string().nullish(), Address: z.string().nullish() });

const item = z.looseObject({
  MessageId: z.string().nullish(),
  InReplyTo: z.string().nullish(),
  From: mailbox.nullish(),
  Subject: z.string().nullish(),
  RawTextBody: z.string().nullish(),
  RawHtmlBody: z.string().nullish(),
  ExtractedMarkdownMessage: z.string().nullish(),
  Headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).nullish(),
});

export type InboundItem = z.infer<typeof item>;

const payload = z.looseObject({ items: z.array(z.unknown()) });

export interface InboundMail {
  from: string | undefined;
  subject: string;
  text: string;
  messageId: string;
  spfPass: boolean;
  dkimPass: boolean;
}

export interface MailWebhookConfig {
  secret: string | undefined;
  onMail?: (item: InboundItem) => Promise<unknown>;
  log?: Pick<Console, 'warn' | 'error'>;
}

export function createMailWebhookRouter(config: MailWebhookConfig): Router {
  const router = Router();
  const log = config.log ?? console;

  router.post('/webhooks/mail/:secret', express.json({ limit: '10mb' }), (req, res) => {
    if (!safeEqual(req.params.secret, config.secret)) {
      res.sendStatus(404);
      return;
    }

    const parsed = payload.safeParse(req.body);
    if (!parsed.success) {
      log.warn('Rejected inbound mail payload without items');
      res.sendStatus(400);
      return;
    }

    res.sendStatus(200);

    for (const raw of parsed.data.items) {
      const mail = item.safeParse(raw);
      if (!mail.success) {
        log.warn('Skipped a malformed inbound mail item');
        continue;
      }
      config.onMail?.(mail.data).catch((error: unknown) => {
        log.error('Inbound mail processing failed:', error);
      });
    }
  });

  return router;
}

export function parseInboundMail(mail: InboundItem): InboundMail {
  const from = extractAddress(mail.From?.Address ?? '');
  const subject = (mail.Subject ?? '').trim();
  const text = mail.RawTextBody?.trim()
    ? mail.RawTextBody
    : mail.RawHtmlBody
      ? htmlToText(mail.RawHtmlBody)
      : (mail.ExtractedMarkdownMessage ?? '');
  const messageId =
    normalizeMessageId(mail.MessageId) ??
    `sha256:${crypto.createHash('sha256').update(`${from}\n${subject}\n${text}`).digest('hex')}`;

  const { spf, dkimDomains } = authResults(mail.Headers ?? {});
  const domain = from?.split('@')[1];

  return {
    from,
    subject,
    text,
    messageId,
    spfPass: spf,
    dkimPass: domain !== undefined && dkimDomains.some((d) => domain === d || domain.endsWith(`.${d}`)),
  };
}

/** "Sam <sam@example.nl>" → "sam@example.nl". */
export function extractAddress(value: string): string | undefined {
  const match = /<([^<>\s]+@[^<>\s]+)>/.exec(value) ?? /([^\s<>"]+@[^\s<>"]+)/.exec(value);
  return match?.[1]?.toLowerCase();
}

function normalizeMessageId(value: string | null | undefined): string | undefined {
  const id = value?.trim();
  if (!id) return undefined;
  return id.startsWith('<') ? id : `<${id}>`;
}

/**
 * Reads SPF and DKIM results from the Authentication-Results and Received-SPF headers
 * that the receiving server adds. Brevo does not send separate fields for them.
 */
export function authResults(headers: Record<string, string | string[]>): {
  spf: boolean;
  dkimDomains: string[];
} {
  const values = (name: string): string[] => {
    const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
    const value = key ? headers[key] : undefined;
    return value === undefined ? [] : Array.isArray(value) ? value : [value];
  };

  const results = values('authentication-results');
  const spf =
    results.some((result) => /\bspf=pass\b/i.test(result)) ||
    values('received-spf').some((result) => /^\s*pass\b/i.test(result));

  const dkimDomains = results.flatMap((result) =>
    [...result.matchAll(/\bdkim=pass\b[^;]*?\bheader\.(?:d|i)=@?([\w.-]+)/gi)].map(([, d = '']) =>
      d.toLowerCase(),
    ),
  );

  return { spf, dkimDomains };
}

function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li)\s*\/?>/gi, '\n')
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, '\n> \n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
