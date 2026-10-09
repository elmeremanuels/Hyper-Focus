// How the day review shapes tomorrow (step 1.11). Pure, so the rules are easy to test.

export type Energy = 'low' | 'normal' | 'high';

export interface TomorrowSignals {
  /** Energy from the last day review; null when it was skipped or never given. */
  energy: Energy | null;
  /** The last (up to) three closed pauses: true when the return was late or never came. */
  lastPausesLate: boolean[];
  /** Open tasks worked on in a block that was extended after 45 minutes, on the review day. */
  hyperfocusTaskIds: number[];
}

export interface TomorrowPlan {
  maxTasks: 2 | 3;
  /** Upper bound in minutes for the quick win; low energy allows a slightly bigger one. */
  quickWinMaxMinutes: number;
  quickWinMinMinutes: number;
  /** Low energy: the focus must contain a quick win. */
  requireQuickWin: boolean;
  blockMinutes: 15 | 25;
  /** This task goes to the top of the focus when it is still open. */
  pinTaskId: number | null;
}

/** Deferred this often, a task gets the proposal to split or park it. */
export const DEFERRED_PROPOSAL_AT = 3;

export function planTomorrow(signals: TomorrowSignals): TomorrowPlan {
  const low = signals.energy === 'low';
  const lateReturns = signals.lastPausesLate.slice(0, 3).filter(Boolean).length;
  const blockMinutes = signals.energy === 'high' && lateReturns < 2 ? 25 : 15;
  return {
    maxTasks: low ? 2 : 3,
    quickWinMinMinutes: low ? 5 : 0,
    quickWinMaxMinutes: low ? 15 : 10,
    requireQuickWin: low,
    blockMinutes,
    pinTaskId: signals.hyperfocusTaskIds[0] ?? null,
  };
}

export function needsDeferProposal(deferredCount: number): boolean {
  return deferredCount >= DEFERRED_PROPOSAL_AT;
}

/** A block counts as hyperfocus when it was extended after at least 45 minutes of work. */
export function isHyperfocusBlock(block: { plannedMinutes: number; extendedMinutes: number; hyperfocusPrompts: number }): boolean {
  return block.extendedMinutes > 0 && (block.plannedMinutes >= 45 || block.hyperfocusPrompts > 0);
}
