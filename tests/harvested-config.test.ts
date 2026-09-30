import { describe, expect, it, vi } from 'vitest';
import { CALENDAR_SCOPES, GoogleCalendarOAuth } from '../src/integrations/calendar/oauth.js';
import { SendGridMailer, type MailTransport } from '../src/channels/email/sendgrid.js';
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

describe('SendGridMailer', () => {
  it('reports missing configuration without sending', async () => {
    const mailer = new SendGridMailer({ apiKey: undefined, from: undefined });
    const result = await mailer.send({ to: 'a@example.nl', subject: 'Test', text: 'Hoi' });
    expect(result.success).toBe(false);
  });

  it('sends through the transport', async () => {
    const transport: MailTransport = {
      setApiKey: vi.fn(),
      send: vi.fn(async () => [{ headers: { 'x-message-id': 'm1' } }, {}] as [
        { headers: Record<string, unknown> },
        unknown,
      ]),
    };
    const mailer = new SendGridMailer({ apiKey: 'key', from: 'hf@example.nl' }, transport);
    const result = await mailer.send({ to: 'a@example.nl', subject: 'Weekoverzicht', text: 'Hoi' });
    expect(result).toEqual({ success: true, messageId: 'm1' });
    expect(transport.setApiKey).toHaveBeenCalledWith('key');
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
