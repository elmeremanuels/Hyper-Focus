import { describe, expect, it } from 'vitest';
import { checkGuardrails, isQuiet, silentDays, type GuardrailInput } from '../src/proactive/guardrails.js';
import { levelForDays } from '../src/proactive/escalation.js';

const NOW = new Date('2026-10-07T09:00:00Z'); // 11:00 in Amsterdam
const base = (overrides: Partial<GuardrailInput> = {}): GuardrailInput => ({
  kind: 'midday',
  now: NOW,
  timezone: 'Europe/Amsterdam',
  settings: { pausedUntil: null, quietStart: '21:00:00', quietEnd: '08:00:00', maxProactivePerDay: 4 },
  sentToday: 0,
  lastProactiveAt: null,
  silentDays: 0,
  overwhelmedYesterday: false,
  ...overrides,
});

describe('checkGuardrails', () => {
  it('sends when nothing blocks', () => {
    expect(checkGuardrails(base())).toEqual({ send: true });
  });

  it('respects the pause, but not for a session check-in', () => {
    const paused = { ...base().settings, pausedUntil: new Date('2026-10-08T00:00:00Z') };
    expect(checkGuardrails(base({ settings: paused }))).toEqual({ send: false, reason: 'paused' });
    expect(checkGuardrails(base({ settings: paused, kind: 'session_checkin' }))).toEqual({ send: true });
  });

  it('keeps quiet hours in the user\'s timezone', () => {
    expect(checkGuardrails(base({ now: new Date('2026-10-07T19:30:00Z') }))).toEqual({ send: false, reason: 'quiet_hours' });
    // 13:30 UTC is 21:30 in Bali.
    expect(checkGuardrails(base({ now: new Date('2026-10-07T13:30:00Z'), timezone: 'Asia/Makassar' }))).toMatchObject({ reason: 'quiet_hours' });
    expect(checkGuardrails(base({ now: new Date('2026-10-07T13:30:00Z') }))).toEqual({ send: true });
  });

  it('caps proactive messages per day', () => {
    expect(checkGuardrails(base({ sentToday: 4 }))).toEqual({ send: false, reason: 'daily_limit' });
    expect(checkGuardrails(base({ sentToday: 3 }))).toEqual({ send: true });
  });

  it('allows one message the day after overwhelm', () => {
    expect(checkGuardrails(base({ overwhelmedYesterday: true }))).toEqual({ send: true });
    expect(checkGuardrails(base({ overwhelmedYesterday: true, sentToday: 1 }))).toEqual({ send: false, reason: 'after_overwhelm' });
  });

  it('postpones to keep 45 minutes between messages', () => {
    const verdict = checkGuardrails(base({ lastProactiveAt: new Date('2026-10-07T08:30:00Z') }));
    expect(verdict).toEqual({ send: false, reason: 'breathing_room', retryAt: new Date('2026-10-07T09:15:00Z') });
    expect(checkGuardrails(base({ lastProactiveAt: new Date('2026-10-07T08:15:00Z') }))).toEqual({ send: true });
  });

  it('withdraws on silence: morning only, then silent, one restart on day 7', () => {
    expect(checkGuardrails(base({ silentDays: 2 }))).toMatchObject({ reason: 'silence_morning_only' });
    expect(checkGuardrails(base({ silentDays: 3, kind: 'morning' }))).toEqual({ send: true });
    expect(checkGuardrails(base({ silentDays: 4, kind: 'morning' }))).toMatchObject({ reason: 'silence' });
    expect(checkGuardrails(base({ silentDays: 7, kind: 'reentry' }))).toEqual({ send: true });
    expect(checkGuardrails(base({ silentDays: 5, kind: 'reentry' }))).toMatchObject({ reason: 'not_silent' });
  });
});

describe('helpers', () => {
  it('counts silent days in local dates', () => {
    // 23:30 on 6 Oct in Amsterdam, then 00:30 on 7 Oct: one day.
    expect(silentDays(new Date('2026-10-06T21:30:00Z'), 'Europe/Amsterdam', new Date('2026-10-06T22:30:00Z'))).toBe(1);
    expect(silentDays(null, 'Europe/Amsterdam', NOW)).toBe(0);
    // Across the clock change on 25 October.
    expect(silentDays(new Date('2026-10-24T10:00:00Z'), 'Europe/Amsterdam', new Date('2026-10-26T10:00:00Z'))).toBe(2);
  });

  it('handles quiet hours that do not wrap midnight', () => {
    expect(isQuiet('Europe/Amsterdam', NOW, '12:00', '14:00')).toBe(false);
    expect(isQuiet('Europe/Amsterdam', new Date('2026-10-07T10:30:00Z'), '12:00', '14:00')).toBe(true);
  });

  it('maps days without movement to escalation levels', () => {
    expect([0, 1, 2, 3, 4, 6, 7, 30].map(levelForDays)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
});

describe('crisis patterns', () => {
  it.each([
    'ik wil er gewoon niet meer zijn',
    'ik wil niet meer leven',
    'denk aan zelfmoord',
    'ik wil mezelf iets aandoen',
  ])('flags "%s"', async (text) => {
    const { looksLikeCrisis } = await import('../src/conversation/wellbeing.js');
    expect(looksLikeCrisis(text)).toBe(true);
  });

  it.each([
    'ik ben er niet meer bij vandaag',
    'die klant is er niet meer',
    'de offerte hoeft er niet meer bij te zijn',
    'ik leef voor de feestdagen',
  ])(
    'leaves "%s" alone',
    async (text) => {
      const { looksLikeCrisis } = await import('../src/conversation/wellbeing.js');
      expect(looksLikeCrisis(text)).toBe(false);
    },
  );
});
