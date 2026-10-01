import { describe, expect, it, vi } from 'vitest';
import { CALENDAR_SCOPES, GoogleCalendarOAuth } from '../src/integrations/calendar/oauth.js';
import { EmailSender, type MailTransport } from '../src/channels/email/send.js';
import { Transcriber } from '../src/ai/transcribe.js';

describe('GoogleCalendarOAuth', () => {
  it('requests only the calendar.readonly scope', () => {
    const oauth = new GoogleCalendarOAuth({
      clientId: 'id',
      clientSecret: 'secret',
      redirectUri: 'https://example.nl/auth/google/callback',
    });
    const url = new URL(oauth.getAuthUrl('signed-state'));
    expect(url.searchParams.get('scope')).toBe(CALENDAR_SCOPES.join(' '));
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('state')).toBe('signed-state');
  });

  it('requires client credentials', () => {
    const oauth = new GoogleCalendarOAuth({
      clientId: undefined,
      clientSecret: undefined,
      redirectUri: undefined,
    });
    expect(() => oauth.getAuthUrl('x')).toThrow(/not configured/);
  });
});

describe('EmailSender', () => {
  it('refuses to send without configuration', async () => {
    const sender = new EmailSender({ apiKey: undefined, from: undefined, replyTo: undefined });
    expect(sender.isConfigured()).toBe(false);
    await expect(
      sender.send({ to: 'a@example.nl', subject: 'Test', text: 'Hoi', html: '<p>Hoi</p>' }),
    ).rejects.toThrow(/not configured/);
  });

  it('sends with Reply-To and threading headers', async () => {
    const send = vi.fn(async () => [{ headers: { 'x-message-id': 'm1' } }, {}] as [
      { headers: Record<string, unknown> },
      unknown,
    ]);
    const transport: MailTransport = { setApiKey: vi.fn(), send };
    const sender = new EmailSender(
      { apiKey: 'key', from: 'hallo@hyper-focus.invalid', replyTo: 'taken@in.hyper-focus.invalid' },
      transport,
    );

    const result = await sender.send({
      to: 'a@example.nl',
      subject: 'Re: Je week',
      text: 'Hoi',
      html: '<p>Hoi</p>',
      inReplyTo: '<abc@mail.example.nl>',
    });

    expect(result).toEqual({ messageId: 'm1' });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        replyTo: 'taken@in.hyper-focus.invalid',
        headers: { 'In-Reply-To': '<abc@mail.example.nl>', References: '<abc@mail.example.nl>' },
      }),
    );
  });
});

describe('Transcriber', () => {
  it('requires a transcription model', async () => {
    const transcriber = new Transcriber({ apiKey: 'key', model: undefined });
    expect(transcriber.isConfigured()).toBe(false);
    await expect(transcriber.transcribe(Buffer.from('x'), 'a.ogg', 'audio/ogg')).rejects.toThrow(
      /TRANSCRIBE_MODEL/,
    );
  });
});
