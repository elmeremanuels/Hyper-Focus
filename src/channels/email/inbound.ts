// SendGrid Inbound Parse: POST /webhooks/mail/{EMAIL_INBOUND_SECRET} (BOUWPLAN.md, 9.3).
// A wrong path gives 404. Fields are parsed from multipart/form-data; attachments are
// skipped and never stored.
import crypto from 'node:crypto';
import busboy from 'busboy';
import { Router, type Request } from 'express';
import { safeEqual } from '../../lib/secrets.js';

export type InboundFields = Record<string, string>;

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
  onMail?: (fields: InboundFields) => Promise<unknown>;
  log?: Pick<Console, 'warn' | 'error'>;
}

export function createMailWebhookRouter(config: MailWebhookConfig): Router {
  const router = Router();
  const log = config.log ?? console;

  router.post('/webhooks/mail/:secret', async (req, res) => {
    if (!safeEqual(req.params.secret, config.secret)) {
      res.sendStatus(404);
      return;
    }

    let fields: InboundFields;
    try {
      fields = await readFields(req);
    } catch (error) {
      log.warn('Could not parse inbound mail:', error);
      res.sendStatus(400);
      return;
    }

    res.sendStatus(200);

    if (config.onMail) {
      config.onMail(fields).catch((error: unknown) => {
        log.error('Inbound mail processing failed:', error);
      });
    }
  });

  return router;
}

function readFields(req: Request): Promise<InboundFields> {
  return new Promise((resolve, reject) => {
    const fields: InboundFields = {};
    let parser: busboy.Busboy;
    try {
      parser = busboy({ headers: req.headers, limits: { fieldSize: 2 * 1024 * 1024, fields: 50 } });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    parser.on('field', (name, value) => {
      fields[name] = value;
    });
    // Attachments are ignored (BOUWPLAN.md, 9.3).
    parser.on('file', (_name, stream) => stream.resume());
    parser.on('error', reject);
    parser.on('close', () => resolve(fields));
    req.pipe(parser);
  });
}

export function parseInboundMail(fields: InboundFields): InboundMail {
  const from = extractAddress(fields.from ?? '');
  const subject = (fields.subject ?? '').trim();
  const text = fields.text?.trim() ? fields.text : htmlToText(fields.html ?? '');
  const headerId = /^Message-ID:\s*(<[^>\s]+>)/im.exec(fields.headers ?? '')?.[1];
  const messageId =
    headerId ??
    `sha256:${crypto.createHash('sha256').update(`${from}\n${subject}\n${text}`).digest('hex')}`;

  return {
    from,
    subject,
    text,
    messageId,
    spfPass: /^\s*pass\b/i.test(fields.SPF ?? ''),
    dkimPass: from !== undefined && dkimPasses(fields.dkim ?? '', from),
  };
}

/** "Sam <sam@example.nl>" → "sam@example.nl". */
export function extractAddress(value: string): string | undefined {
  const match = /<([^<>\s]+@[^<>\s]+)>/.exec(value) ?? /([^\s<>"]+@[^\s<>"]+)/.exec(value);
  return match?.[1]?.toLowerCase();
}

/** dkim looks like "{@gmail.com : pass}" or "{@a.nl : fail, @b.nl : pass}". */
function dkimPasses(dkim: string, from: string): boolean {
  const domain = from.split('@')[1];
  if (!domain) return false;
  return [...dkim.matchAll(/@([\w.-]+)\s*:\s*(\w+)/g)].some(([, signer = '', result = '']) => {
    const d = signer.toLowerCase();
    return result.toLowerCase() === 'pass' && (domain === d || domain.endsWith(`.${d}`));
  });
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
