import { describe, expect, it } from 'vitest';
import { composeFocus, type FocusCandidate } from '../src/proactive/focus.js';
import { isHyperfocusBlock, needsDeferProposal, planTomorrow, type TomorrowSignals } from '../src/proactive/tomorrow.js';

const signals = (overrides: Partial<TomorrowSignals> = {}): TomorrowSignals => ({
  energy: null,
  lastPausesLate: [],
  hyperfocusTaskIds: [],
  ...overrides,
});

describe('planTomorrow', () => {
  it('low energy: two tasks with a quick win of 5–15 minutes, blocks of 15', () => {
    expect(planTomorrow(signals({ energy: 'low' }))).toMatchObject({
      maxTasks: 2,
      requireQuickWin: true,
      quickWinMinMinutes: 5,
      quickWinMaxMinutes: 15,
      blockMinutes: 15,
    });
  });

  it('normal or no energy: three tasks, blocks of 15 (as before)', () => {
    for (const energy of ['normal', null] as const) {
      expect(planTomorrow(signals({ energy }))).toMatchObject({ maxTasks: 3, quickWinMaxMinutes: 10, blockMinutes: 15 });
    }
  });

  it('high energy: three tasks, blocks of 25', () => {
    expect(planTomorrow(signals({ energy: 'high' }))).toMatchObject({ maxTasks: 3, blockMinutes: 25 });
  });

  it('late from 2 of the last 3 pauses: blocks of 15, also with high energy', () => {
    expect(planTomorrow(signals({ energy: 'high', lastPausesLate: [true, false, true] })).blockMinutes).toBe(15);
    expect(planTomorrow(signals({ energy: 'high', lastPausesLate: [true, false, false] })).blockMinutes).toBe(25);
  });

  it('puts the hyperfocus task of yesterday on top', () => {
    expect(planTomorrow(signals({ hyperfocusTaskIds: [7, 9] })).pinTaskId).toBe(7);
    expect(planTomorrow(signals()).pinTaskId).toBeNull();
  });

  it('proposes splitting or parking from the third deferral', () => {
    expect([0, 2, 3, 5].map(needsDeferProposal)).toEqual([false, false, true, true]);
  });

  it('counts a block extended after 45 minutes as hyperfocus', () => {
    expect(isHyperfocusBlock({ plannedMinutes: 45, extendedMinutes: 15, hyperfocusPrompts: 0 })).toBe(true);
    expect(isHyperfocusBlock({ plannedMinutes: 25, extendedMinutes: 15, hyperfocusPrompts: 1 })).toBe(true);
    expect(isHyperfocusBlock({ plannedMinutes: 25, extendedMinutes: 15, hyperfocusPrompts: 0 })).toBe(false);
    expect(isHyperfocusBlock({ plannedMinutes: 45, extendedMinutes: 0, hyperfocusPrompts: 0 })).toBe(false);
  });
});

describe('composeFocus with the plan for tomorrow', () => {
  const NOW = new Date('2026-10-07T06:00:00Z');
  const task = (id: number, estimatedMinutes: number, overrides: Partial<FocusCandidate> = {}): FocusCandidate => ({
    id,
    estimatedMinutes,
    dueDate: null,
    carryOver: false,
    isWeeklyFocus: false,
    projectPriority: 3,
    createdAt: new Date(`2026-10-0${Math.min(id, 6)}T10:00:00Z`),
    ...overrides,
  });
  const candidates = [task(1, 60, { isWeeklyFocus: true }), task(2, 30), task(3, 12), task(4, 30)];

  it('low energy keeps two tasks: the main task and a quick win of up to 15 minutes', () => {
    const focus = composeFocus(candidates, '2026-10-07', NOW, planTomorrow(signals({ energy: 'low' })));
    expect(focus.taskIds).toEqual([1, 3]);
    expect(focus.quickWinTaskId).toBe(3);
  });

  it('normal energy keeps the rule of three', () => {
    expect(composeFocus(candidates, '2026-10-07', NOW, planTomorrow(signals({ energy: 'normal' }))).taskIds).toHaveLength(3);
  });

  it('a pinned task becomes the main task', () => {
    const focus = composeFocus(candidates, '2026-10-07', NOW, planTomorrow(signals({ hyperfocusTaskIds: [4] })));
    expect(focus.taskIds[0]).toBe(4);
    expect(focus.mainTaskId).toBe(4);
  });
});
