import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createDelivery } from '../src/channels/channel.js';
import { EmailChannel } from '../src/channels/email/channel.js';
import {
  authResults,
  extractAddress,
  parseInboundMail,
  type InboundItem,
} from '../src/channels/email/inbound.js';
import { createMailProcessor, EMPTY_REPLY, replySubject } from '../src/channels/email/processor.js';
import { detectForward, extractReply } from '../src/channels/email/parse-reply.js';
import { BREVO_SEND_URL, EmailSender } from '../src/channels/email/send.js';
import { createMemoryRouterDeps } from '../src/conversation/deps.js';
import { createRouter } from '../src/conversation/router.js';
import { fixture } from './helpers/fixtures.js';
import { MemoryMessageStore, MemoryUserStore, sam } from './helpers/memory.js';
import { fakeBrevoFetch } from './helpers/brevo.js';
import { startServer, type RunningServer } from './helpers/server.js';

describe('extractReply', () => {
  it('cuts a Gmail reply at "Op … schreef …:" across a wrapped line', () => {
    const text = (fixture<InboundItem>('mail', 'reply-gmail').RawTextBody ?? '');
    expect(extractReply(text)).toBe('vandaag');
  });

  it('cuts an English Gmail reply', () => {
    expect(extractReply('Done!\n\nOn Wed, Oct 1, 2026 at 8:30 AM Hyper&Focus <hallo@x.nl> wrote:\n> vraag')).toBe('Done!');
  });

  it('cuts an Outlook reply at the separator and drops the mobile footer', () => {
    const text = fixture<InboundItem>('mail', 'reply-outlook').RawTextBody ?? '';
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
    const mail = fixture<InboundItem>('mail', 'forward');
    const forward = detectForward(mail.Subject ?? '', mail.RawTextBody ?? '');
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
  it('reads sender, Message-ID and spam score from an actual-format Brevo item', () => {
    expect(parseInboundMail(fixture('mail', 'reply-gmail'))).toMatchObject({
      from: 'sam@voorbeeld.invalid',
      subject: 'Re: Bericht van Hyper&Focus',
      messageId: '<CAGmail-1@mail.gmail.com>',
      spamScore: 1.2,
    });
  });

  it('reports SPF and DKIM as absent: Brevo sends no results', () => {
    const mail = parseInboundMail(fixture('mail', 'reply-gmail'));
    expect(mail.spf).toBe('absent');
    expect(mail.dkim).toBe('absent');
    expect(mail.headerNames).toEqual([
      'Content-Type',
      'DKIM-Signature',
      'Date',
      'From',
      'In-Reply-To',
      'MIME-Version',
      'Message-ID',
      'Received',
      'References',
      'Subject',
      'To',
    ]);
  });

  it('reads failing results when a server did add Authentication-Results', () => {
    const mail = parseInboundMail(fixture('mail', 'auth-headers-fail'));
    expect(mail.spf).toBe('fail');
    expect(mail.dkim).toBe('fail');
  });

  it('reads the documented Spam.Score as well', () => {
    expect(parseInboundMail({ From: { Address: 'a@b.nl' }, Spam: { Score: 3.1 } }).spamScore).toBe(3.1);
    expect(parseInboundMail({ From: { Address: 'a@b.nl' } }).spamScore).toBeUndefined();
  });

  it('falls back to the HTML body, then to the Uuid or a content hash', () => {
    const html = parseInboundMail({ From: { Address: 'a@b.nl' }, Subject: 'x', RawHtmlBody: '<p>Hallo&nbsp;daar</p>' });
    expect(html.text).toBe('Hallo daar');
    expect(html.messageId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(parseInboundMail({ From: { Address: 'a@b.nl' }, Uuid: ['u-1'] }).messageId).toBe('uuid:u-1');
  });

  it('adds angle brackets to a bare Message-ID', () => {
    expect(parseInboundMail({ From: { Address: 'a@b.nl' }, MessageId: 'abc@b.nl' }).messageId).toBe('<abc@b.nl>');
  });

  it('extracts the address from a display name', () => {
    expect(extractAddress('"Sam V." <Sam@Voorbeeld.invalid>')).toBe('sam@voorbeeld.invalid');
    expect(extractAddress('sam@voorbeeld.invalid')).toBe('sam@voorbeeld.invalid');
  });
});

describe('authResults', () => {
  it('returns absent without Authentication-Results or Received-SPF', () => {
    expect(authResults({ 'DKIM-Signature': 'v=1; d=voorbeeld.invalid' })).toEqual({
      spf: 'absent',
      dkimDomains: undefined,
    });
  });

  it('reads several Authentication-Results headers and Received-SPF', () => {
    expect(
      authResults({
        'authentication-results': [
          'mx.invalid; dkim=pass header.i=@Mail.Example.nl header.s=k1',
          'mx.invalid; dkim=fail header.d=other.nl',
        ],
        'Received-SPF': 'Pass (mx.invalid: domain of a@example.nl designates 1.2.3.4 as permitted sender)',
      }),
    ).toEqual({ spf: 'pass', dkimDomains: ['mail.example.nl'] });
  });

  it('reports fail for a non-pass SPF result', () => {
    expect(authResults({ 'Received-SPF': 'softfail (domain does not designate)' }).spf).toBe('fail');
  });

  it('accepts a DKIM signature of a parent domain', () => {
    const mail = parseInboundMail({
      From: { Address: 'sam@mail.voorbeeld.invalid' },
      Headers: { 'Authentication-Results': 'mx; spf=pass; dkim=pass header.d=voorbeeld.invalid' },
    });
    expect(mail.dkim).toBe('pass');
  });
});

function setup(options: { maxSpamScore?: number } = {}) {
  const brevo = fakeBrevoFetch();
  const messages = new MemoryMessageStore();
  const users = new MemoryUserStore([sam()]);
  const email = new EmailChannel(
    new EmailSender(
      { apiKey: 'key', from: 'hallo@hyper-focus.invalid', replyTo: 'taken@in.hyper-focus.invalid' },
      brevo.fetchImpl,
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
    ...(options.maxSpamScore !== undefined && { maxSpamScore: options.maxSpamScore }),
    log,
  });
  return { sent: brevo.sent, messages, log, process };
}

describe('mail processor', () => {
  it('answers a reply by mail in the same thread, with buttons as action links', async () => {
    const { sent, messages, process } = setup();

    expect(await process(fixture('mail', 'reply-gmail'))).toBe('processed');

    const mail = sent[0]?.body;
    expect(mail).toMatchObject({
      sender: { name: 'Hyper&Focus', email: 'hallo@hyper-focus.invalid' },
      to: [{ email: 'sam@voorbeeld.invalid' }],
      subject: 'Re: Bericht van Hyper&Focus',
      replyTo: { email: 'taken@in.hyper-focus.invalid' },
      headers: { 'In-Reply-To': '<CAGmail-1@mail.gmail.com>' },
    });
    expect(mail?.textContent).toContain('Vandaag, in deze volgorde');
    expect(mail?.textContent).toMatch(/Start 1: https:\/\/hyper-focus\.invalid\/a\/[\w-]+\.[\w-]+/);
    expect(mail?.htmlContent).toContain('href="https://hyper-focus.invalid/a/');

    expect(messages.inbound()).toMatchObject([
      { channel: 'email', externalId: '<CAGmail-1@mail.gmail.com>', body: 'vandaag' },
    ]);
    expect(messages.outbound()).toMatchObject([
      { channel: 'email', externalId: '<brevo-1@smtp-relay.invalid>', type: 'email' },
    ]);
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

  it('accepts mail without SPF/DKIM results from an allowed sender', async () => {
    const { log, process } = setup();
    expect(await process(fixture('mail', 'reply-outlook'))).toBe('processed');
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('ignores an unknown sender, reported auth failures and spam', async () => {
    const { sent, messages, log, process } = setup();
    expect(await process(fixture('mail', 'unknown-sender'))).toBe('ignored');
    expect(await process(fixture('mail', 'auth-headers-fail'))).toBe('ignored');
    expect(await process(fixture('mail', 'spam'))).toBe('ignored');
    expect(sent).toHaveLength(0);
    expect(messages.messages).toHaveLength(0);
    expect(log.warn.mock.calls.map((call) => String(call[0]))).toEqual([
      'Ignored inbound mail from i*****@elders.invalid: unknown sender',
      'Ignored inbound mail from s**@voorbeeld.invalid: SPF fail',
      'Ignored inbound mail from s**@voorbeeld.invalid: spam score 9.5 above 5',
    ]);
  });

  it('honours a custom spam limit', async () => {
    const { process } = setup({ maxSpamScore: 10 });
    expect(await process(fixture('mail', 'spam'))).toBe('processed');
  });

  it('logs the header names of the first mail once, without values', async () => {
    const { log, process } = setup();
    await process(fixture('mail', 'reply-gmail'));
    await process(fixture('mail', 'forward'));

    const lines = log.info.mock.calls.map((call) => String(call[0]));
    expect(lines).toEqual([
      'Brevo inbound header names: Content-Type, DKIM-Signature, Date, From, In-Reply-To, MIME-Version, Message-ID, Received, References, Subject, To; SpamScore present',
    ]);
    expect(lines[0]).not.toContain('voorbeeld.invalid');
  });

  it('asks for text when a reply only holds quoted text', async () => {
    const { sent, process } = setup();
    await process({
      ...fixture<InboundItem>('mail', 'reply-gmail'),
      MessageId: '<empty@x>',
      RawTextBody: '> alleen citaat',
    });
    expect(sent[0]?.body.textContent).toContain(EMPTY_REPLY.text);
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

  const post = (baseUrl: string, path: string, body: unknown) =>
    fetch(`${baseUrl}/webhooks/mail/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('returns 404 for a wrong path', async () => {
    const onMail = vi.fn(async () => undefined);
    server = await startServer(createApp({ mail: { secret: SECRET, onMail } }));
    expect((await post(server.baseUrl, 'wrong', { items: [] })).status).toBe(404);
    expect(onMail).not.toHaveBeenCalled();
  });

  it('returns 404 when no secret is configured', async () => {
    server = await startServer(createApp());
    expect((await post(server.baseUrl, SECRET, { items: [] })).status).toBe(404);
  });

  it('returns 400 without an items array', async () => {
    server = await startServer(createApp({ mail: { secret: SECRET, onMail: vi.fn(async () => undefined) } }));
    expect((await post(server.baseUrl, SECRET, { nope: true })).status).toBe(400);
  });

  it('answers 200 and hands every item to the processor', async () => {
    const onMail = vi.fn(async () => undefined);
    server = await startServer(createApp({ mail: { secret: SECRET, onMail } }));
    const items = [fixture('mail', 'reply-gmail'), fixture('mail', 'forward')];

    const response = await post(server.baseUrl, SECRET, { items });

    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(onMail).toHaveBeenCalledTimes(2));
    expect((onMail.mock.calls[1] as unknown as [InboundItem])[0].Subject).toBe('Fwd: Banner voor vrijdag');
  });
});

describe('EmailSender (Brevo)', () => {
  it('refuses to send without configuration', async () => {
    const sender = new EmailSender({ apiKey: undefined, from: undefined, replyTo: undefined });
    expect(sender.isConfigured()).toBe(false);
    await expect(
      sender.send({ to: 'a@example.nl', subject: 'Test', text: 'Hoi', html: '<p>Hoi</p>' }),
    ).rejects.toThrow(/not configured/);
  });

  it('posts to the Brevo API with the api-key header', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const sender = new EmailSender(
      { apiKey: 'xkeysib-test', from: 'hallo@hyper-focus.invalid', replyTo: undefined },
      (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ messageId: '<m1@relay>' }), { status: 201 });
      }) as typeof fetch,
    );

    expect(await sender.send({ to: 'a@example.nl', subject: 'Je week', text: 'Hoi', html: '<p>Hoi</p>' })).toEqual({
      messageId: '<m1@relay>',
    });
    expect(calls[0]?.url).toBe(BREVO_SEND_URL);
    expect((calls[0]?.init?.headers as Record<string, string>)['api-key']).toBe('xkeysib-test');
    expect(JSON.parse(String(calls[0]?.init?.body))).not.toHaveProperty('replyTo');
  });

  it('throws with Brevo\'s message on an error status', async () => {
    const brevo = fakeBrevoFetch();
    brevo.failWith(401, 'Key not found');
    const sender = new EmailSender({ apiKey: 'bad', from: 'hallo@hyper-focus.invalid', replyTo: undefined }, brevo.fetchImpl);
    await expect(sender.send({ to: 'a@b.nl', subject: 's', text: 't', html: 'h' })).rejects.toThrow(
      'Brevo send failed (401): Key not found',
    );
  });
});
