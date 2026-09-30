import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env.js';

describe('parseEnv', () => {
  it('applies defaults when variables are missing or empty', () => {
    const env = parseEnv({ NODE_ENV: '', DEFAULT_TIMEZONE: '' });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.DEFAULT_TIMEZONE).toBe('Europe/Amsterdam');
    expect(env.RESEARCH_PROVIDER).toBe('claude');
    expect(env.WHATSAPP_ALLOWED_NUMBERS).toEqual([]);
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

  it('parses a comma-separated list of E.164 numbers', () => {
    const env = parseEnv({ WHATSAPP_ALLOWED_NUMBERS: '+31600000001, +6281200000002' });
    expect(env.WHATSAPP_ALLOWED_NUMBERS).toEqual(['+31600000001', '+6281200000002']);
  });

  it('rejects numbers without a plus sign', () => {
    expect(() => parseEnv({ WHATSAPP_ALLOWED_NUMBERS: '31600000001' })).toThrow(
      /WHATSAPP_ALLOWED_NUMBERS/,
    );
  });

  it('rejects an unknown research provider', () => {
    expect(() => parseEnv({ RESEARCH_PROVIDER: 'bing' })).toThrow(/RESEARCH_PROVIDER/);
  });

  it('coerces PORT to a number', () => {
    expect(parseEnv({ PORT: '8080' }).PORT).toBe(8080);
  });
});
