import { describe, expect, it } from 'vitest';
import { CALENDAR_SCOPES, GoogleCalendarOAuth } from '../src/integrations/calendar/oauth.js';
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

describe('Transcriber', () => {
  it('requires a transcription model', async () => {
    const transcriber = new Transcriber({ apiKey: 'key', model: undefined });
    expect(transcriber.isConfigured()).toBe(false);
    await expect(transcriber.transcribe(Buffer.from('x'), 'a.ogg', 'audio/ogg')).rejects.toThrow(
      /TRANSCRIBE_MODEL/,
    );
  });
});
