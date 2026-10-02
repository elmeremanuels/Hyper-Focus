// Brevo Inbound Parsing: POST /webhooks/mail/{EMAIL_INBOUND_SECRET} (BOUWPLAN.md, 9.3).
// A wrong path gives 404. Brevo posts JSON with an `items` array, one entry per mail.
// Attachments are ignored and never stored.
import crypto from 'node:crypto';
import express, { Router } from 'express';
import { z } from 'zod';
import { safeEqual } from '../../lib/secrets.js';

const mailbox = z.looseObject({ Name: z.string().nullish(), Address: z.string().nullish() });

// Field names follow an actual Brevo payload: the spam score arrives as `SpamScore`,
// although Brevo documents `Spam.Score`; both are read.
const item = z.looseObject({
  Uuid: z.array(z.string()).nullish(),
  MessageId: z.string().nullish(),
  InReplyTo: z.string().nullish(),
  From: mailbox.nullish(),
  Subject: z.string().nullish(),
  RawTextBody: z.string().nullish(),
  RawHtmlBody: z.string().nullish(),
  ExtractedMarkdownMessage: z.string().nullish(),
  Headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).nullish(),
  SpamScore: z.number().nullish(),
  Spam: z.looseObject({ Score: z.number().nullish() }).nullish(),
});

export type InboundItem = z.infer<typeof item>;

const payload = z.looseObject({ items: z.array(z.unknown()) });

/** `absent` when the mail carries no result for the check (Brevo adds none itself). */
export type AuthResult = 'pass' | 'fail' | 'absent';

export interface InboundMail {
  from: string | undefined;
  subject: string;
  text: string;
  messageId: string;
  spf: AuthResult;
  dkim: AuthResult;
  spamScore: number | undefined;
  headerNames: string[];
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
    (mail.Uuid?.[0] ? `uuid:${mail.Uuid[0]}` : undefined) ??
    `sha256:${crypto.createHash('sha256').update(`${from}\n${subject}\n${text}`).digest('hex')}`;

  const headers = mail.Headers ?? {};
  const { spf, dkimDomains } = authResults(headers);
  const domain = from?.split('@')[1];
  const dkim: AuthResult =
    dkimDomains === undefined
      ? 'absent'
      : domain !== undefined && dkimDomains.some((d) => domain === d || domain.endsWith(`.${d}`))
        ? 'pass'
        : 'fail';

  return {
    from,
    subject,
    text,
    messageId,
    spf,
    dkim,
    spamScore: mail.SpamScore ?? mail.Spam?.Score ?? undefined,
    headerNames: Object.keys(headers).sort(),
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
 * Reads SPF and DKIM results from Authentication-Results and Received-SPF, when present.
 * An actual Brevo payload carries neither header, so both results are usually absent.
 * `dkimDomains` is undefined when no header reports a DKIM result.
 */
export function authResults(headers: Record<string, string | string[]>): {
  spf: AuthResult;
  dkimDomains: string[] | undefined;
} {
  const values = (name: string): string[] => {
    const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
    const value = key ? headers[key] : undefined;
    return value === undefined ? [] : Array.isArray(value) ? value : [value];
  };

  const results = values('authentication-results');
  const spfResults = [
    ...results.flatMap((result) => [...result.matchAll(/\bspf=(\w+)/gi)].map(([, r = '']) => r.toLowerCase())),
    ...values('received-spf').map((result) => /^\s*(\w+)/.exec(result)?.[1]?.toLowerCase() ?? ''),
  ];
  const spf: AuthResult = spfResults.length === 0 ? 'absent' : spfResults.includes('pass') ? 'pass' : 'fail';

  const reportsDkim = results.some((result) => /\bdkim=\w+/i.test(result));
  const dkimDomains = reportsDkim
    ? results.flatMap((result) =>
        [...result.matchAll(/\bdkim=pass\b[^;]*?\bheader\.(?:d|i)=@?([\w.-]+)/gi)].map(([, d = '']) =>
          d.toLowerCase(),
        ),
      )
    : undefined;

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
