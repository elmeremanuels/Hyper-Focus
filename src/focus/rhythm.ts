// Learning the focus window from someone's own data (step 1.12, A2). Pure, so easy to test.
// Per weekday and per half hour between 07:00 and 21:00, over the last 28 days.
import { overlapsQuiet, toTime } from './window.js';

export interface RhythmBlock {
  /** Local date YYYY-MM-DD and ISO weekday (1 = Monday). */
  date: string;
  weekday: number;
  /** Local minutes since midnight. */
  startMinute: number;
  endMinute: number;
  outcome: 'completed' | 'extended' | 'stopped' | 'expired' | null;
  extended: boolean;
}

export interface RhythmTask {
  date: string;
  weekday: number;
  minute: number;
}

export interface RhythmReview {
  date: string;
  energy: 'low' | 'normal' | 'high' | null;
}

export interface RhythmOptions {
  quietStart: string;
  quietEnd: string;
  /** ISO weekdays someone works; the average for thin weekdays uses only these. Default Monday to Friday. */
  workDays?: readonly number[];
}

export interface WeekdayWindow {
  weekday: number;
  /** Local start, HH:MM. */
  start: string;
  minutes: number;
  /** 0–1: the share of the scores inside the window, damped with little data. */
  confidence: number;
}

export interface RhythmResult {
  windows: WeekdayWindow[];
  /** Days with at least one finished block, and the number of finished blocks. */
  activeDays: number;
  completedBlocks: number;
  /** 10 work days with at least 6 finished blocks: enough to propose a learned window. */
  eligible: boolean;
}

export const FIRST_SLOT = 7 * 60;
export const SLOTS = 28; // 07:00–21:00 in half hours
export const WINDOW_SLOTS = 3; // 90 minutes
const ENERGY_FACTOR = { low: 0.5, normal: 1, high: 1.25 } as const;
export const MIN_ACTIVE_DAYS = 10;
export const MIN_COMPLETED_BLOCKS = 6;

const slotOf = (minute: number) => Math.floor((minute - FIRST_SLOT) / 30);

function weight(block: RhythmBlock): number {
  if (block.outcome === 'extended' || block.extended) return 3;
  if (block.outcome === 'completed') return 2;
  if (block.outcome === 'stopped' || block.outcome === 'expired') return -1;
  return 0;
}

export function scoreHours(blocks: RhythmBlock[], reviews: RhythmReview[], tasks: RhythmTask[], options: RhythmOptions): RhythmResult {
  const days = new Map<string, { weekday: number; slots: number[] }>();
  const day = (date: string, weekday: number) => {
    let entry = days.get(date);
    if (!entry) days.set(date, (entry = { weekday, slots: new Array<number>(SLOTS).fill(0) }));
    return entry;
  };

  for (const block of blocks) {
    const w = weight(block);
    if (w === 0) continue;
    const entry = day(block.date, block.weekday);
    for (let i = Math.max(0, slotOf(block.startMinute)); i < SLOTS; i++) {
      const slotStart = FIRST_SLOT + i * 30;
      if (slotStart >= block.endMinute) break;
      if (slotStart + 30 > block.startMinute) entry.slots[i] = (entry.slots[i] ?? 0) + w;
    }
  }
  for (const task of tasks) {
    const i = slotOf(task.minute);
    if (i < 0 || i >= SLOTS) continue;
    const entry = day(task.date, task.weekday);
    entry.slots[i] = (entry.slots[i] ?? 0) + 1;
  }
  const energy = new Map(reviews.map((r) => [r.date, r.energy]));
  for (const [date, entry] of days) {
    const e = energy.get(date);
    const factor = e ? ENERGY_FACTOR[e] : 1;
    entry.slots = entry.slots.map((s) => s * factor);
  }

  const finished = blocks.filter((b) => b.outcome === 'completed' || b.outcome === 'extended');
  const activeDays = new Set(finished.map((b) => b.date)).size;
  const damping = Math.min(1, activeDays / MIN_ACTIVE_DAYS);

  const sum = (rows: number[][]) => Array.from({ length: SLOTS }, (_, i) => rows.reduce((total, row) => total + (row[i] ?? 0), 0));
  const workDays = options.workDays ?? [1, 2, 3, 4, 5];
  const workdays = [...days.values()].filter((d) => workDays.includes(d.weekday));
  const average = sum(workdays.map((d) => d.slots)).map((s) => s / Math.max(1, workdays.length));

  const windows: WeekdayWindow[] = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    const own = [...days.values()].filter((d) => d.weekday === weekday);
    // Too little data for this weekday: the average over all work days.
    const profile = own.length >= 2 ? sum(own.map((d) => d.slots)) : average;
    const best = bestWindow(profile, options);
    if (!best) continue;
    const positive = profile.reduce((total, s) => total + Math.max(0, s), 0);
    const share = positive > 0 ? Math.max(0, best.score) / positive : 0;
    windows.push({ weekday, start: best.start, minutes: WINDOW_SLOTS * 30, confidence: Math.round(share * damping * 100) / 100 });
  }
  return {
    windows,
    activeDays,
    completedBlocks: finished.length,
    eligible: activeDays >= MIN_ACTIVE_DAYS && finished.length >= MIN_COMPLETED_BLOCKS,
  };
}

/** The 90 minutes with the highest sum, outside quiet hours. Ties go to the earlier start. */
function bestWindow(profile: number[], options: RhythmOptions): { start: string; score: number } | undefined {
  let best: { start: string; score: number } | undefined;
  for (let i = 0; i + WINDOW_SLOTS <= SLOTS; i++) {
    const start = toTime(FIRST_SLOT + i * 30);
    if (overlapsQuiet(start, WINDOW_SLOTS * 30, options.quietStart, options.quietEnd)) continue;
    const score = profile.slice(i, i + WINDOW_SLOTS).reduce((a, b) => a + b, 0);
    if (!best || score > best.score) best = { start, score };
  }
  return best;
}
