import { describe, expect, it } from 'vitest';
import { composeFocus, scoreTask, type FocusCandidate } from '../src/proactive/focus.js';

const NOW = new Date('2026-10-07T06:00:00Z');
const TODAY = '2026-10-07';
const task = (id: number, overrides: Partial<FocusCandidate> = {}): FocusCandidate => ({
  id,
  estimatedMinutes: 30,
  dueDate: null,
  carryOver: false,
  isWeeklyFocus: false,
  projectPriority: 3,
  createdAt: new Date('2026-10-06T10:00:00Z'),
  ...overrides,
});

describe('scoreTask', () => {
  it('adds the points from BOUWPLAN 11.3', () => {
    expect(scoreTask(task(1), TODAY, NOW)).toBe(0);
    expect(scoreTask(task(1, { dueDate: '2026-10-09' }), TODAY, NOW)).toBe(3);
    expect(scoreTask(task(1, { dueDate: '2026-10-10' }), TODAY, NOW)).toBe(0);
    expect(scoreTask(task(1, { carryOver: true }), TODAY, NOW)).toBe(2);
    expect(scoreTask(task(1, { isWeeklyFocus: true }), TODAY, NOW)).toBe(2);
    expect(scoreTask(task(1, { projectPriority: 1 }), TODAY, NOW)).toBe(2);
    expect(scoreTask(task(1, { projectPriority: 2 }), TODAY, NOW)).toBe(1);
    expect(scoreTask(task(1, { createdAt: new Date('2026-09-29T00:00:00Z') }), TODAY, NOW)).toBe(1);
  });
});

describe('composeFocus', () => {
  it('picks the main task, one quick win and a third within three hours', () => {
    const focus = composeFocus(
      [
        task(1, { isWeeklyFocus: true, estimatedMinutes: 60 }),
        task(2, { estimatedMinutes: 15, projectPriority: 2 }),
        task(3, { estimatedMinutes: 5 }),
        task(4, { estimatedMinutes: 5 }),
      ],
      TODAY,
      NOW,
    );
    expect(focus).toEqual({ taskIds: [1, 3, 2], mainTaskId: 1, quickWinTaskId: 3 });
  });

  it('never has more than three tasks or more than one quick win', () => {
    const many = Array.from({ length: 10 }, (_, i) => task(i + 1, { estimatedMinutes: 5 }));
    const focus = composeFocus(many, TODAY, NOW);
    expect(focus.taskIds).toHaveLength(3);
    expect(focus.quickWinTaskId).toBe(2);
  });

  it('drops the third task when the total passes three hours', () => {
    const focus = composeFocus(
      [task(1, { estimatedMinutes: 120, projectPriority: 1 }), task(2, { estimatedMinutes: 5 }), task(3, { estimatedMinutes: 60 })],
      TODAY,
      NOW,
    );
    expect(focus.taskIds).toEqual([1, 2]);
  });

  it('works without a quick win and with an empty list', () => {
    expect(composeFocus([task(1), task(2)], TODAY, NOW)).toEqual({ taskIds: [1, 2], mainTaskId: 1, quickWinTaskId: null });
    expect(composeFocus([], TODAY, NOW).taskIds).toEqual([]);
  });
});

describe('composeFocus: the window task (verbeterplan P0.1)', () => {
  it('puts the long important task in the window, not the 15-minute invoice', () => {
    const invoice = task(1, { estimatedMinutes: 15, projectPriority: 1 });
    const yearPlan = task(2, { estimatedMinutes: 120, projectPriority: 1 });
    const quick = task(3, { estimatedMinutes: 5 });
    const focus = composeFocus([invoice, yearPlan, quick], TODAY, NOW);
    expect(focus.mainTaskId).toBe(2);
    expect(focus.quickWinTaskId).toBe(3);
    expect(focus.taskIds).toEqual([2, 3, 1]);
  });

  it('keeps the highest score first, and on a tie takes the longest that fits the window', () => {
    const urgent = task(1, { estimatedMinutes: 30, dueDate: '2026-10-08' });
    const long = task(2, { estimatedMinutes: 120 });
    expect(composeFocus([long, urgent], TODAY, NOW).mainTaskId).toBe(1);

    const sixty = task(3, { estimatedMinutes: 60 });
    const hour2 = task(4, { estimatedMinutes: 120 });
    // 120 minutes counts as the window (60 here): a tie, so the earlier task wins.
    expect(composeFocus([sixty, hour2], TODAY, NOW, { windowMinutes: 60 }).mainTaskId).toBe(3);
    expect(composeFocus([sixty, hour2], TODAY, NOW, { windowMinutes: 90 }).mainTaskId).toBe(4);
  });

  it('falls back to the best task when nothing is 30 minutes or longer, and a pin wins', () => {
    expect(composeFocus([task(1, { estimatedMinutes: 15, projectPriority: 1 }), task(2, { estimatedMinutes: 5 })], TODAY, NOW).mainTaskId).toBe(1);
    expect(composeFocus([task(1, { estimatedMinutes: 15 }), task(2, { estimatedMinutes: 120 })], TODAY, NOW, { pinTaskId: 1 }).mainTaskId).toBe(1);
  });
});
