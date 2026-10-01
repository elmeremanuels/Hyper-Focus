import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createDelivery } from '../src/channels/channel.js';
import { EmailChannel } from '../src/channels/email/channel.js';
import { extractAddress, parseInboundMail, type InboundFields } from '../src/channels/email/inbound.js';
import { createMailProcessor, EMPTY_REPLY, replySubject } from '../src/channels/email/processor.js';
import { detectForward, extractReply } from '../src/channels/email/parse-reply.js';
import { EmailSender, type EmailMessage, type MailTransport } from '../src/channels/email/send.js';
import { createMemoryRouterDeps } from '../src/conversation/deps.js';
import { createRouter } from '../src/conversation/router.js';
import { fixture } from './helpers/fixtures.js';
import { MemoryMessageStore, MemoryUserStore, sam } from './helpers/memory.js';
import { startServer, type RunningServer } from './helpers/server.js';

describe('extractReply', () => {
  it('cuts a Gmail reply at "Op … schreef …:" across a wrapped line', () => {
    const text = (fixture<InboundFields>('mail', 'reply-gmail').text ?? '');
    expect(extractReply(text)).toBe('vandaag');
  });

  it('cuts an English Gmail reply', () => {
    expect(extractReply('Done!\n\nOn Wed, Oct 1, 2026 at 8:30 AM Hyper&Focus <hallo@x.nl> wrote:\n> vraag')).toBe('Done!');
  });

  it('cuts an Outlook reply at the separator and drops the mobile footer', () => {
    const text = fixture<InboundFields>('mail', 'reply-outlook').text ?? '';
    expect(extractReply(text)).toBe('Help');
  });

  it('cuts an Outlook desktop reply at the From/Sent header block', () => {
    const text = 'Doe ik morgen\r\n\r\nFrom: Hyper&Focus <hallo@x.nl>\r\nSent: Wednesday, October 1, 2026 8:30 AM\r\nTo: Sam\r\nSubject: Focus';
    expect(extractReply(text)).toBe('Doe ik morgen');
  });

  it('cuts an Apple Mail reply in Dutch and its signature', () => {
    const text =
      'Offerte is de deur uit\n\n-- \nSam\nStudio Voorbeeld\n\n> Op 1 okt 2026 om 08:30 heeft Hyper&Focus <hallo@x.nl> het volgende geschreven:\n>\n> Vraag';
    expect(extractReply(text)).toBe('Offerte is de deur uit');
  });

  it('cuts at "Verzonden vanaf mijn iPhone"', () => {
    expect(extractReply('Klaar\n\nVerzonden vanaf mijn iPhone\n\nOp 1 okt. 2026 om 08:30 heeft X het volgende geschreven:')).toBe('Klaar');
  });

  it('keeps a message without quotes', () => {
    expect(extractReply('klant wil banner voor vrijdag\nen een flyer')).toBe('klant wil banner voor vrijdag\nen een flyer');
  });
});

describe('detectForward', () => {
  it('reads the note, original sender and subject from a forwarded mail', () => {
    const mail = fixture<InboundFields>('mail', 'forward');
    const forward = detectForward(mail.subject ?? '', mail.text ?? '');
    expect(forward).toMatchObject({
      note: 'Kun je hier een taak van maken?',
      originalFrom: 'Anna <anna@bakkerij.invalid>',
      originalSubject: 'Banner voor vrijdag',
    });
    expect(forward?.excerpt).toContain('banner voor vrijdag klaar');
  });

  it('caps the excerpt at 2,000 characters', () => {
    const forward = detectForward('Fwd: lang', 'x'.repeat(5000));
    expect(forward?.excerpt).toHaveLength(2000);
  });

  it('returns undefined for a normal reply', () => {
    expect(detectForward('Re: Focus', 'Gedaan')).toBeUndefined();
  });
});

describe('parseInboundMail', () => {
  it('reads sender, Message-ID and passing SPF and DKIM', () => {
    expect(parseInboundMail(fixture('mail', 'reply-gmail'))).toMatchObject({
      from: 'sam@voorbeeld.invalid',
      subject: 'Re: Bericht van Hyper&Focus',
      messageId: '<CAGmail-1@mail.gmail.com>',
      spfPass: true,
      dkimPass: true,
    });
  });

  it('fails DKIM when the signature is for another domain', () => {
    const mail = parseInboundMail(fixture('mail', 'spf-fail'));
    expect(mail.spfPass).toBe(false);
    expect(mail.dkimPass).toBe(false);
  });

  it('falls back to the HTML body and a content hash when fields are missing', () => {
    const mail = parseInboundMail({ from: 'a@b.nl', subject: 'x', html: '<p>Hallo&nbsp;daar</p>' });
    expect(mail.text).toBe('Hallo daar');
    expect(mail.messageId).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('extracts the address from a display name', () => {
    expect(extractAddress('"Sam V." <Sam@Voorbeeld.invalid>')).toBe('sam@voorbeeld.invalid');
    expect(extractAddress('sam@voorbeeld.invalid')).toBe('sam@voorbeeld.invalid');
  });
});

function setup() {
  const sent: Array<Parameters<MailTransport['send']>[0]> = [];
  const transport: MailTransport = {
    setApiKey: () => undefined,
    send: async (message) => {
      sent.push(message);
      return [{ headers: { 'x-message-id': `sg-${sent.length}` } }, {}];
    },
  };
  const messages = new MemoryMessageStore();
  const users = new MemoryUserStore([sam()]);
  const email = new EmailChannel(
    new EmailSender(
      { apiKey: 'key', from: 'hallo@hyper-focus.invalid', replyTo: 'taken@in.hyper-focus.invalid' },
      transport,
    ),
    messages,
    { actionLinkSecret: 'k'.repeat(32), baseUrl: 'https://hyper-focus.invalid' },
  );
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const process = createMailProcessor({
    users,
    messages,
    delivery: createDelivery({ email }, log),
    router: createRouter(
      createMemoryRouterDeps('Sam', [
        { id: 11, title: 'Factuur versturen', estimatedMinutes: 5, projectTitle: 'Losse taken' },
      ]),
    ),
    allowedSenders: ['sam@voorbeeld.invalid'],
    log,
  });
  return { sent, messages, log, process };
}

describe('mail processor', () => {
  it('answers a reply by mail in the same thread, with buttons as action links', async () => {
    const { sent, messages, process } = setup();

    expect(await process(fixture('mail', 'reply-gmail'))).toBe('processed');

    const [mail] = sent as unknown as Array<EmailMessage & { headers: Record<string, string>; replyTo: string }>;
    expect(mail).toMatchObject({
      to: 'sam@voorbeeld.invalid',
      subject: 'Re: Bericht van Hyper&Focus',
      replyTo: 'taken@in.hyper-focus.invalid',
      headers: { 'In-Reply-To': '<CAGmail-1@mail.gmail.com>' },
    });
    expect(mail?.text).toContain('Vandaag, in deze volgorde');
    expect(mail?.text).toMatch(/Start 1: https:\/\/hyper-focus\.invalid\/a\/[\w-]+\.[\w-]+/);
    expect(mail?.html).toContain('href="https://hyper-focus.invalid/a/');

    expect(messages.inbound()).toMatchObject([
      { channel: 'email', externalId: '<CAGmail-1@mail.gmail.com>', body: 'vandaag' },
    ]);
    expect(messages.outbound()).toMatchObject([{ channel: 'email', externalId: 'sg-1', type: 'email' }]);
    expect(messages.events.map((event) => event.name)).toEqual(['inbound_message', 'email_sent']);
  });

  it('processes a duplicate Message-ID once', async () => {
    const { sent, process } = setup();
    await process(fixture('mail', 'reply-gmail'));
    expect(await process(fixture('mail', 'reply-gmail'))).toBe('duplicate');
    expect(sent).toHaveLength(1);
  });

  it('passes a forwarded mail with context to the router', async () => {
    const { messages, process } = setup();
    expect(await process(fixture('mail', 'forward'))).toBe('processed');
    expect(messages.inbound()[0]?.body).toContain('Doorgestuurde mail van Anna <anna@bakkerij.invalid>, onderwerp "Banner voor vrijdag".');
    expect(messages.inbound()[0]?.body).toContain('Kun je hier een taak van maken?');
  });

  it('ignores an unknown sender and a failed SPF check', async () => {
    const { sent, messages, log, process } = setup();
    expect(await process(fixture('mail', 'unknown-sender'))).toBe('ignored');
    expect(await process(fixture('mail', 'spf-fail'))).toBe('ignored');
    expect(sent).toHaveLength(0);
    expect(messages.messages).toHaveLength(0);
    expect(log.warn.mock.calls.map((call) => String(call[0]))).toEqual([
      'Ignored inbound mail from i*****@elders.invalid: unknown sender',
      'Ignored inbound mail from s**@voorbeeld.invalid: SPF not pass',
    ]);
  });

  it('asks for text when a reply only holds quoted text', async () => {
    const { sent, process } = setup();
    await process({
      ...fixture<InboundFields>('mail', 'reply-gmail'),
      headers: 'Message-ID: <empty@x>\n',
      text: '> alleen citaat',
    });
    expect((sent[0] as unknown as EmailMessage).text).toContain(EMPTY_REPLY.text);
  });

  it('builds the reply subject', () => {
    expect(replySubject('Je week')).toBe('Re: Je week');
    expect(replySubject('RE: Je week')).toBe('RE: Je week');
    expect(replySubject('')).toBe('Re: Je bericht');
  });
});

describe('POST /webhooks/mail/:secret', () => {
  const SECRET = 'inbound-secret-123456';
  let server: RunningServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  function form(fields: InboundFields) {
    const body = new FormData();
    for (const [name, value] of Object.entries(fields)) body.append(name, value);
    body.append('attachment1', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'factuur.pdf');
    return body;
  }

  it('returns 404 for a wrong path', async () => {
    const onMail = vi.fn(async () => undefined);
    server = await startServer(createApp({ mail: { secret: SECRET, onMail } }));
    const response = await fetch(`${server.baseUrl}/webhooks/mail/wrong`, { method: 'POST', body: form({ from: 'x' }) });
    expect(response.status).toBe(404);
    expect(onMail).not.toHaveBeenCalled();
  });

  it('returns 404 when no secret is configured', async () => {
    server = await startServer(createApp());
    const response = await fetch(`${server.baseUrl}/webhooks/mail/${SECRET}`, { method: 'POST', body: form({}) });
    expect(response.status).toBe(404);
  });

  it('parses the multipart fields, skips attachments and answers 200', async () => {
    const onMail = vi.fn(async () => undefined);
    server = await startServer(createApp({ mail: { secret: SECRET, onMail } }));
    const fields = fixture<InboundFields>('mail', 'reply-gmail');

    const response = await fetch(`${server.baseUrl}/webhooks/mail/${SECRET}`, { method: 'POST', body: form(fields) });

    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(onMail).toHaveBeenCalled());
    const received = (onMail.mock.calls[0] as unknown as [InboundFields])[0];
    expect(received.from).toBe(fields.from);
    expect(received.text?.replace(/\r\n/g, '\n')).toBe(fields.text);
    expect(Object.keys(received)).not.toContain('attachment1');
  });
});
