import { describe, expect, it } from 'vitest';
import { scoreHours, type RhythmBlock, type RhythmReview } from '../src/focus/rhythm.js';
import { chooseWindow, overlapsQuiet, type WindowInput } from '../src/focus/window.js';

const base: WindowInput = { pref: null, prefStart: null, prefMinutes: 90, quietStart: '21:00', quietEnd: '08:00' };

describe('chooseWindow', () => {
  it('takes manual > learned > preference > standard', () => {
    const learned = { start: '13:30', minutes: 90, confidence: 0.7 };
    expect(chooseWindow({ ...base, pref: 'morning', learned, manual: { start: '14:00', minutes: 90 } })).toEqual({ start: '14:00', minutes: 90, source: 'manual' });
    expect(chooseWindow({ ...base, pref: 'morning', learned })).toEqual({ start: '13:30', minutes: 90, source: 'learned' });
    expect(chooseWindow({ ...base, pref: 'morning' })).toEqual({ start: '09:30', minutes: 90, source: 'pref' });
    expect(chooseWindow(base)).toEqual({ start: '10:30', minutes: 90, source: 'pref' });
  });

  it('maps the four answers to their standard windows', () => {
    expect((['morning', 'afternoon', 'evening', 'unknown'] as const).map((pref) => chooseWindow({ ...base, pref }).start)).toEqual([
      '09:30',
      '13:30',
      '19:00',
      '10:30',
    ]);
  });

  it('ignores a learned window below confidence 0.4', () => {
    expect(chooseWindow({ ...base, pref: 'afternoon', learned: { start: '10:00', minutes: 90, confidence: 0.39 } }).source).toBe('pref');
  });

  it('keeps the evening window out of quiet hours', () => {
    expect(chooseWindow({ ...base, pref: 'evening', quietStart: '20:00', quietEnd: '07:00' })).toEqual({ start: '10:30', minutes: 90, source: 'pref' });
    expect(overlapsQuiet('19:00', 90, '21:00', '08:00')).toBe(false);
    expect(overlapsQuiet('20:00', 90, '21:00', '08:00')).toBe(true);
  });
});

/** Two weeks of work days with blocks from 13:30 to 15:00 and a short stopped block in the morning. */
function afternoonPeak(days = 14): { blocks: RhythmBlock[]; reviews: RhythmReview[] } {
  const blocks: RhythmBlock[] = [];
  const start = Date.parse('2026-09-07T00:00:00Z'); // a Monday
  for (let d = 0, worked = 0; worked < days; d++) {
    const date = new Date(start + d * 86_400_000).toISOString().slice(0, 10);
    const weekday = ((d % 7) + 1);
    if (weekday > 5) continue;
    worked++;
    blocks.push(
      { date, weekday, startMinute: 13 * 60 + 30, endMinute: 14 * 60 + 15, outcome: 'completed', extended: false },
      { date, weekday, startMinute: 14 * 60 + 20, endMinute: 15 * 60, outcome: 'completed', extended: false },
      { date, weekday, startMinute: 9 * 60, endMinute: 9 * 60 + 10, outcome: 'stopped', extended: false },
    );
  }
  return { blocks, reviews: [] };
}

describe('scoreHours', () => {
  const quiet = { quietStart: '21:00', quietEnd: '08:00' };

  it('finds an afternoon peak around 13:30 with high confidence', () => {
    const { blocks, reviews } = afternoonPeak();
    const result = scoreHours(blocks, reviews, [], quiet);
    expect(result.eligible).toBe(true);
    const tuesday = result.windows.find((w) => w.weekday === 2)!;
    expect(tuesday.start).toBe('13:30');
    expect(tuesday.minutes).toBe(90);
    expect(tuesday.confidence).toBeGreaterThanOrEqual(0.4);
  });

  it('gives low confidence with little data, so the preference stays', () => {
    const { blocks } = afternoonPeak(3);
    const result = scoreHours(blocks, [], [], quiet);
    expect(result.eligible).toBe(false);
    for (const w of result.windows) expect(w.confidence).toBeLessThan(0.4);
    const learned = result.windows.find((w) => w.weekday === 1)!;
    expect(chooseWindow({ ...base, pref: 'morning', learned }).start).toBe('09:30');
  });

  it('weighs extended blocks, finished tasks and the energy of the day', () => {
    const blocks: RhythmBlock[] = [
      { date: '2026-09-07', weekday: 1, startMinute: 600, endMinute: 690, outcome: 'completed', extended: false },
      { date: '2026-09-14', weekday: 1, startMinute: 900, endMinute: 990, outcome: 'extended', extended: true },
    ];
    // A low-energy day halves its scores, so the extended afternoon wins.
    const result = scoreHours(blocks, [{ date: '2026-09-07', energy: 'low' }], [{ date: '2026-09-14', weekday: 1, minute: 920 }], quiet);
    expect(result.windows.find((w) => w.weekday === 1)?.start).toBe('15:00');
  });

  it('never puts the window in quiet hours', () => {
    const blocks: RhythmBlock[] = [{ date: '2026-09-07', weekday: 1, startMinute: 19 * 60 + 30, endMinute: 20 * 60 + 30, outcome: 'completed', extended: false }];
    const result = scoreHours(blocks, [], [], { quietStart: '20:00', quietEnd: '08:00' });
    const monday = result.windows.find((w) => w.weekday === 1)!;
    expect(overlapsQuiet(monday.start, monday.minutes, '20:00', '08:00')).toBe(false);
  });
});
