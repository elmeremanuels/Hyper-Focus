// Composes the daily focus (BOUWPLAN.md, 11.3). Pure, so it is easy to test.

export interface FocusCandidate {
  id: number;
  estimatedMinutes: number | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
  carryOver: boolean;
  isWeeklyFocus: boolean;
  /** 1 (highest) to 3. */
  projectPriority: number;
  createdAt: Date;
}

export interface ComposedFocus {
  /** Ordered: main task, quick win, optional third. At most three. */
  taskIds: number[];
  mainTaskId: number | null;
  quickWinTaskId: number | null;
}

export const QUICK_WIN_MAX_MINUTES = 10;
/** The window task is real work: at least this long (verbeterplan P0.1). */
export const WINDOW_MIN_MINUTES = 30;
const DEFAULT_WINDOW_MINUTES = 90;
export const FOCUS_MAX_MINUTES = 180;
/** Used for the 3-hour check when a task has no estimate. */
const UNKNOWN_ESTIMATE = 30;

/** Days between two YYYY-MM-DD dates. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function scoreTask(task: FocusCandidate, today: string, now: Date): number {
  let score = 0;
  if (task.dueDate !== null && daysBetween(today, task.dueDate) <= 2) score += 3;
  if (task.carryOver) score += 2;
  if (task.isWeeklyFocus) score += 2;
  score += Math.max(0, Math.min(2, 3 - task.projectPriority));
  if (now.getTime() - task.createdAt.getTime() > 7 * 86_400_000) score += 1;
  return score;
}

/** Shapes the focus after the day review (step 1.11); see tomorrow.ts. */
export interface FocusShape {
  maxTasks: number;
  quickWinMinMinutes: number;
  quickWinMaxMinutes: number;
  pinTaskId: number | null;
  /** Length of the focus window; the main task should fill it. */
  windowMinutes: number;
}

const DEFAULT_SHAPE: FocusShape = {
  maxTasks: 3,
  quickWinMinMinutes: 0,
  quickWinMaxMinutes: QUICK_WIN_MAX_MINUTES,
  pinTaskId: null,
  windowMinutes: DEFAULT_WINDOW_MINUTES,
};

/**
 * One main task, one quick win (≤ 10 minutes), and a third only while the total estimate stays
 * within 3 hours. A pinned task becomes the main task.
 *
 * The main task goes into the focus window (verbeterplan P0.1): the highest score among tasks of
 * at least 30 minutes, and on a tie the longest that fits the window. A task longer than the
 * window counts as the window's length: its first step goes in. Quick wins stay out of the
 * window. Without such a task, the highest score wins as before.
 */
export function composeFocus(candidates: FocusCandidate[], today: string, now: Date, shape: Partial<FocusShape> = {}): ComposedFocus {
  const { maxTasks, quickWinMinMinutes, quickWinMaxMinutes, pinTaskId, windowMinutes } = { ...DEFAULT_SHAPE, ...shape };
  const sorted = candidates
    .map((task) => ({ task, score: scoreTask(task, today, now) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.task.dueDate ?? '9999').localeCompare(b.task.dueDate ?? '9999') ||
        a.task.createdAt.getTime() - b.task.createdAt.getTime() ||
        a.task.id - b.task.id,
    )
    .map((entry) => entry.task);
  const minutes = (task: FocusCandidate) => task.estimatedMinutes ?? UNKNOWN_ESTIMATE;
  const fill = (task: FocusCandidate) => Math.min(minutes(task), windowMinutes);
  const score = (task: FocusCandidate) => scoreTask(task, today, now);
  const deep = sorted
    .filter((task) => minutes(task) >= WINDOW_MIN_MINUTES)
    .reduce<FocusCandidate | undefined>((best, task) => (!best || score(task) > score(best) || (score(task) === score(best) && fill(task) > fill(best)) ? task : best), undefined);
  const pinned = sorted.find((task) => task.id === pinTaskId) ?? deep;
  const ranked = pinned ? [pinned, ...sorted.filter((task) => task !== pinned)] : sorted;

  const main = ranked[0];
  if (!main) return { taskIds: [], mainTaskId: null, quickWinTaskId: null };

  const rest = ranked.slice(1);
  const quickWin = rest.find(
    (task) =>
      task.estimatedMinutes !== null && task.estimatedMinutes >= quickWinMinMinutes && task.estimatedMinutes <= quickWinMaxMinutes,
  );
  const picked = [main, ...(quickWin && maxTasks > 1 ? [quickWin] : [])];

  for (const task of rest) {
    if (picked.length >= Math.min(3, maxTasks)) break;
    if (picked.includes(task)) continue;
    const total = [...picked, task].reduce((sum, t) => sum + minutes(t), 0);
    if (total <= FOCUS_MAX_MINUTES) picked.push(task);
  }

  return {
    taskIds: picked.map((task) => task.id),
    mainTaskId: main.id,
    quickWinTaskId: quickWin && picked.includes(quickWin) ? quickWin.id : null,
  };
}
