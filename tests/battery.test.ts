import { describe, expect, it } from 'vitest';
import { batteryState, type BatteryInput } from '../src/focus/battery.js';

// Europe/Amsterdam, summer time: 10:30 local is 08:30 UTC.
const at = (time: string) => new Date(`2026-10-07T${time}Z`);
const window = {
  startsAt: at('08:30:00'),
  endsAt: at('10:00:00'),
  status: 'planned' as const,
  source: 'learned' as const,
  task: { id: 12, title: 'Offerte Boho' },
  confidence: 0.62,
};
const input = (now: string, overrides: Partial<BatteryInput> = {}): BatteryInput => ({
  now: at(now),
  timezone: 'Europe/Amsterdam',
  window,
  nextWindow: { startsAt: new Date('2026-10-08T08:30:00Z'), endsAt: new Date('2026-10-08T10:00:00Z') },
  activeBlock: undefined,
  recentEvents: [],
  lastSegments: 2,
  ...overrides,
});

describe('batteryState', () => {
  it('idles more than an hour before the window, dimmed, with the window of today', () => {
    expect(batteryState(input('07:00:00'))).toMatchObject({ state: 'idle', segments: 2, dimmed: true, label: 'Volgend focusvenster vandaag 10:30' });
  });

  it('charges in the hour before the window: 1 to 4 segments, rising with time', () => {
    expect(['07:31:00', '07:50:00', '08:10:00', '08:20:00'].map((t) => batteryState(input(t)).segments)).toEqual([1, 2, 3, 4]);
    expect(batteryState(input('08:10:00'))).toMatchObject({
      state: 'charging',
      label: 'Focusvenster over 20 minuten',
      windowStartsAt: '2026-10-07T10:30:00+02:00',
      windowEndsAt: '2026-10-07T12:00:00+02:00',
      task: { id: 12, title: 'Offerte Boho' },
      source: 'learned',
      confidence: 0.62,
    });
  });

  it('adds a segment for a small task or a pitstop in that hour, at most 4', () => {
    const events = [{ kind: 'small_task_done' as const, at: at('07:40:00') }];
    expect(batteryState(input('07:50:00', { recentEvents: events })).segments).toBe(3);
    const many = [...events, { kind: 'pitstop_done' as const, at: at('07:45:00') }, { kind: 'pitstop_done' as const, at: at('08:00:00') }];
    expect(batteryState(input('08:20:00', { recentEvents: many })).segments).toBe(4);
    // Events before the hour do not count.
    expect(batteryState(input('07:50:00', { recentEvents: [{ kind: 'pitstop_done', at: at('06:00:00') }] })).segments).toBe(2);
  });

  it('is ready when the window begins and no block runs', () => {
    expect(batteryState(input('08:30:00'))).toMatchObject({ state: 'ready', segments: 4, label: 'Focusvenster begint. Offerte Boho ligt klaar' });
  });

  it('is in focus while a block runs, with the minutes', () => {
    const block = { phase: 'block' as const, startedAt: at('08:31:00'), inWindow: true, pauseStartedAt: null, pauseDueAt: null };
    expect(batteryState(input('09:53:00', { activeBlock: block }))).toMatchObject({ state: 'focus', segments: 4, elapsedMinutes: 82, label: 'In focus, 82 minuten' });
  });

  it('refills from 2 to 4 during the pitstop', () => {
    const pause = { phase: 'pause' as const, startedAt: at('08:31:00'), inWindow: true, pauseStartedAt: at('09:53:00'), pauseDueAt: at('09:55:00') };
    expect(['09:53:00', '09:54:00', '09:55:00'].map((t) => batteryState(input(t, { activeBlock: pause })).segments)).toEqual([2, 3, 4]);
    expect(batteryState(input('09:54:00', { activeBlock: pause })).label).toBe('Pitstop, terug om 11:55');
  });

  it('goes to idle with the next window after a missed window, never empty', () => {
    const missed = { ...window, status: 'missed' as const };
    const state = batteryState(input('09:10:00', { window: missed, lastSegments: 0 }));
    expect(state).toMatchObject({ state: 'idle', segments: 1, dimmed: true, label: 'Volgend focusvenster morgen 10:30', windowStartsAt: '2026-10-08T10:30:00+02:00' });
  });

  it('idles after the window and without any window', () => {
    expect(batteryState(input('10:30:00', { lastSegments: 4 }))).toMatchObject({ state: 'idle', segments: 4, label: 'Volgend focusvenster morgen 10:30' });
    expect(batteryState(input('10:30:00', { window: undefined, nextWindow: undefined }))).toMatchObject({ state: 'idle', label: 'Geen focusvenster gepland' });
  });

  it('never returns 0 segments', () => {
    for (let m = 0; m < 24 * 60; m += 7) {
      const now = new Date(at('00:00:00').getTime() + m * 60_000);
      expect(batteryState({ ...input('00:00:00', { lastSegments: 0 }), now }).segments).toBeGreaterThanOrEqual(1);
    }
  });
});
