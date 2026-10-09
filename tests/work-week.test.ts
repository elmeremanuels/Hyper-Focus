import { describe, expect, it } from 'vitest';
import { chooseWindow, fitWorkHours } from '../src/focus/window.js';
import { describeDays, firstWorkday, isWorkday, lastWorkday, normalizeDays, parseDays } from '../src/focus/workweek.js';

describe('work week', () => {
  it('puts the weekly review on the last work day and the Monday mail on the first', () => {
    expect(lastWorkday([1, 2, 3, 4, 5])).toBe(5);
    expect(lastWorkday([1, 2, 3, 4])).toBe(4);
    expect(lastWorkday([2, 3, 4, 5, 6])).toBe(6);
    expect(firstWorkday([2, 3, 4, 5, 6])).toBe(2);
    expect(isWorkday([1, 2, 3, 4], 5)).toBe(false);
  });

  it('describes and parses the days', () => {
    expect(describeDays([1, 2, 3, 4, 5])).toBe('ma t/m vr');
    expect(describeDays([1, 2, 4])).toBe('ma, di en do');
    expect(describeDays([2, 3, 4, 5, 6])).toBe('di t/m za');
    expect(parseDays('1234')).toEqual([1, 2, 3, 4]);
    expect(normalizeDays([])).toEqual([1, 2, 3, 4, 5]);
    expect(normalizeDays([5, 1, 1, 9])).toEqual([1, 5]);
  });

  it('keeps a learned or preferred window inside the work hours', () => {
    expect(fitWorkHours('07:30', 90, '08:00', '15:00')).toBe('08:00');
    expect(fitWorkHours('14:00', 90, '08:00', '15:00')).toBe('13:30');
    expect(fitWorkHours('10:30', 90, '08:00', '15:00')).toBe('10:30');
    const base = { pref: 'afternoon' as const, prefStart: null, prefMinutes: 90, quietStart: '21:00', quietEnd: '08:00' };
    expect(chooseWindow({ ...base, workStart: '08:00', workEnd: '14:00' }).start).toBe('12:30');
    // A window moved by hand stays where it was put.
    expect(chooseWindow({ ...base, workStart: '08:00', workEnd: '14:00', manual: { start: '16:00', minutes: 90 } }).start).toBe('16:00');
  });
});
