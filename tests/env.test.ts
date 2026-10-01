import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env.js';

describe('parseEnv', () => {
  it('applies defaults when variables are missing or empty', () => {
    const env = parseEnv({ NODE_ENV: '', DEFAULT_TIMEZONE: '' });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.DEFAULT_TIMEZONE).toBe('Europe/Amsterdam');
    expect(env.RESEARCH_PROVIDER).toBe('claude');
    expect(env.TELEGRAM_ALLOWED_USER_IDS).toEqual([]);
    expect(env.EMAIL_ALLOWED_SENDERS).toEqual([]);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('does not supply default model names', () => {
    const env = parseEnv({});
    expect(env.CLAUDE_MODEL_FAST).toBeUndefined();
    expect(env.CLAUDE_MODEL_SMART).toBeUndefined();
  });

  it('accepts the test timezones', () => {
    expect(parseEnv({ DEFAULT_TIMEZONE: 'Asia/Makassar' }).DEFAULT_TIMEZONE).toBe('Asia/Makassar');
    expect(parseEnv({ DEFAULT_TIMEZONE: 'Europe/Amsterdam' }).DEFAULT_TIMEZONE).toBe(
      'Europe/Amsterdam',
    );
  });

  it('rejects an unknown timezone', () => {
    expect(() => parseEnv({ DEFAULT_TIMEZONE: 'Mars/Olympus' })).toThrow(/DEFAULT_TIMEZONE/);
  });

  it('parses Telegram user ids and allowed senders', () => {
    const env = parseEnv({
      TELEGRAM_ALLOWED_USER_IDS: '123456789, 987654321',
      EMAIL_ALLOWED_SENDERS: 'Sam@Voorbeeld.invalid',
    });
    expect(env.TELEGRAM_ALLOWED_USER_IDS).toEqual([123456789, 987654321]);
    expect(env.EMAIL_ALLOWED_SENDERS).toEqual(['sam@voorbeeld.invalid']);
  });

  it('rejects malformed ids, addresses and short secrets', () => {
    expect(() => parseEnv({ TELEGRAM_ALLOWED_USER_IDS: 'abc' })).toThrow(/TELEGRAM_ALLOWED_USER_IDS/);
    expect(() => parseEnv({ EMAIL_ALLOWED_SENDERS: 'geen-mail' })).toThrow(/EMAIL_ALLOWED_SENDERS/);
    expect(() => parseEnv({ TELEGRAM_WEBHOOK_SECRET: 'kort' })).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
    expect(() => parseEnv({ TELEGRAM_WEBHOOK_SECRET: 'x'.repeat(31) + '!' })).toThrow(
      /TELEGRAM_WEBHOOK_SECRET/,
    );
    expect(() => parseEnv({ ACTION_LINK_SECRET: 'kort' })).toThrow(/ACTION_LINK_SECRET/);
  });

  it('rejects an unknown research provider', () => {
    expect(() => parseEnv({ RESEARCH_PROVIDER: 'bing' })).toThrow(/RESEARCH_PROVIDER/);
  });

  it('coerces PORT to a number', () => {
    expect(parseEnv({ PORT: '8080' }).PORT).toBe(8080);
  });
});
