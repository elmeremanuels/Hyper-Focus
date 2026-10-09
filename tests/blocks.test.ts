import { describe, expect, it } from 'vitest';
import { signInitData, validateInitData } from '../src/channels/telegram/webapp.js';
import { toInlineKeyboard } from '../src/channels/telegram/keyboard.js';
import { roundToPreset } from '../src/conversation/blocks.js';
import { checkGuardrails, type GuardrailInput } from '../src/proactive/guardrails.js';
import { BLOCK_TEXTS, PAUSE_MISSIONS } from '../src/texts/werkblokken.nl.js';

describe('work block units', () => {
  it('rounds any duration to 15, 25, 45, 60 or 90 minutes', () => {
    expect([1, 15, 19, 20, 21, 25, 30, 35, 40, 45, 52, 53, 75, 90, 120].map(roundToPreset)).toEqual([
      15, 15, 15, 15, 25, 25, 25, 25, 45, 45, 45, 60, 60, 90, 90,
    ]);
  });

  it('keeps the four short pitstop missions, the toilet with 3 minutes', () => {
    expect(Object.values(PAUSE_MISSIONS).map((m) => m.text)).toEqual([
      'pak een glas water',
      'sta op en strek je uit',
      'loop even naar het toilet',
      'adem drie keer diep in bij het raam',
    ]);
    expect(PAUSE_MISSIONS.toilet.minutes).toBe(3);
    expect(BLOCK_TEXTS.pitstopDone).toContain('Telefoon blijft liggen.');
    expect(BLOCK_TEXTS.returnReminder).toBe('Pitstop voorbij. Terug naar je werk?');
  });

  it('renders the reward minute as a Telegram web app button', () => {
    expect(toInlineKeyboard({ text: 'Welkom terug.', buttons: [{ id: 'rwd:1', title: 'Je minuut', webApp: 'https://hyper-focus.pro/app/beloning?t=abc' }] })).toEqual({
      inline_keyboard: [[{ text: 'Je minuut', web_app: { url: 'https://hyper-focus.pro/app/beloning?t=abc' } }]],
    });
  });
});

describe('Telegram web app initData', () => {
  const token = '123:abc';
  const now = new Date('2026-10-07T10:00:00Z');
  const sign = (userId: number, authDate: Date, botToken = token) =>
    signInitData({ auth_date: String(Math.floor(authDate.getTime() / 1000)), query_id: 'q1', user: JSON.stringify({ id: userId, first_name: 'Sam' }) }, botToken);

  it('accepts data signed with the bot token', () => {
    expect(validateInitData(sign(42, now), token, now)).toEqual({ telegramUserId: 42, authDate: now });
  });

  it('rejects data that is forged, signed with another token, or older than 24 hours', () => {
    expect(validateInitData(sign(42, now).replace('%22id%22%3A42', '%22id%22%3A43'), token, now)).toBeUndefined();
    expect(validateInitData(sign(42, now, '999:zzz'), token, now)).toBeUndefined();
    expect(validateInitData(sign(42, new Date(now.getTime() - 25 * 3_600_000)), token, now)).toBeUndefined();
    expect(validateInitData('user=%7B%22id%22%3A42%7D', token, now)).toBeUndefined();
  });
});

describe('work block guardrails', () => {
  const input = (kind: string, overrides: Partial<GuardrailInput['settings']> = {}): GuardrailInput => ({
    kind,
    timezone: 'Asia/Makassar',
    now: new Date('2026-10-07T14:30:00Z'), // 22:30 in Makassar
    settings: { quietStart: '21:00', quietEnd: '08:00', pausedUntil: null, maxProactivePerDay: 4, ...overrides },
    sentToday: 10,
    lastProactiveAt: new Date('2026-10-07T14:25:00Z'),
    silentDays: 5,
    overwhelmedYesterday: false,
  });

  it('lets quiet hours win over the return reminder, the block end and the hyperfocus pause', () => {
    for (const kind of ['return_reminder', 'block_end', 'hyperfocus_break']) {
      expect(checkGuardrails(input(kind))).toMatchObject({ send: false, reason: 'quiet_hours' });
    }
  });

  it('lets /pauze win, and ignores the daily limit and silence otherwise', () => {
    const day = { quietStart: '23:00', quietEnd: '06:00' };
    expect(checkGuardrails(input('return_reminder', { ...day, pausedUntil: new Date('2026-10-08T00:00:00Z') }))).toMatchObject({ send: false, reason: 'paused' });
    expect(checkGuardrails(input('return_reminder', day))).toEqual({ send: true });
  });

  it('always closes a pause, because closing sends nothing', () => {
    expect(checkGuardrails(input('pause_close'))).toEqual({ send: true });
  });
});
