// Choosing the focus window of a day (step 1.12, A1). Pure, so the order is easy to test:
// manual for that day > learned (A2) > preference > standard.

export type FocusPref = 'morning' | 'afternoon' | 'evening' | 'unknown';
export type WindowSource = 'manual' | 'learned' | 'pref';

export interface WindowChoice {
  /** Local start, HH:MM. */
  start: string;
  minutes: number;
  source: WindowSource;
}

export const DEFAULT_WINDOW_MINUTES = 90;

/** Standard windows per preference. "Weet ik niet" and no answer start at 10:30. */
export const PREF_WINDOWS: Record<FocusPref, string> = {
  morning: '09:30',
  afternoon: '13:30',
  evening: '19:00',
  unknown: '10:30',
};

/** Below this confidence the learned window does not count (A2). */
export const MIN_CONFIDENCE = 0.4;

export const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export const toTime = (minutes: number) => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** True when [start, start + minutes) touches the quiet hours (which may wrap midnight). */
export function overlapsQuiet(start: string, minutes: number, quietStart: string, quietEnd: string): boolean {
  const from = toMinutes(quietStart);
  const to = toMinutes(quietEnd);
  const quiet = (m: number) => {
    const t = ((m % 1440) + 1440) % 1440;
    return from <= to ? t >= from && t < to : t >= from || t < to;
  };
  const s = toMinutes(start);
  for (let m = s; m < s + minutes; m += 5) if (quiet(m)) return true;
  return false;
}

export interface WindowInput {
  manual?: { start: string; minutes: number } | undefined;
  /** The accepted learned window for this weekday, with its confidence. */
  learned?: { start: string; minutes: number; confidence: number } | undefined;
  pref: FocusPref | null;
  /** A start chosen by the user ("mijn focus is om 14:00"); wins over the preference table. */
  prefStart: string | null;
  prefMinutes: number;
  quietStart: string;
  quietEnd: string;
  /** Work hours (HH:MM); a learned or preferred window moves inside them. */
  workStart?: string | undefined;
  workEnd?: string | undefined;
}

/** Moves a window inside the work hours when it sticks out; a window longer than the day starts at work start. */
export function fitWorkHours(start: string, minutes: number, workStart?: string, workEnd?: string): string {
  if (!workStart || !workEnd) return start;
  const from = toMinutes(workStart);
  const to = toMinutes(workEnd);
  if (to <= from) return start;
  const s = toMinutes(start);
  if (s < from) return toTime(from);
  if (s + minutes > to) return toTime(Math.max(from, to - minutes));
  return start;
}

export function chooseWindow(input: WindowInput): WindowChoice {
  const choice = choose(input);
  if (choice.source === 'manual') return choice;
  return { ...choice, start: fitWorkHours(choice.start, choice.minutes, input.workStart, input.workEnd) };
}

function choose(input: WindowInput): WindowChoice {
  if (input.manual) return { ...input.manual, source: 'manual' };
  const fits = (start: string, minutes: number) => !overlapsQuiet(start, minutes, input.quietStart, input.quietEnd);
  const { learned } = input;
  if (learned && learned.confidence >= MIN_CONFIDENCE && fits(learned.start, learned.minutes)) {
    return { start: learned.start, minutes: learned.minutes, source: 'learned' };
  }
  const prefStart = input.prefStart?.slice(0, 5) ?? PREF_WINDOWS[input.pref ?? 'unknown'];
  if (fits(prefStart, input.prefMinutes)) return { start: prefStart, minutes: input.prefMinutes, source: 'pref' };
  // An evening window inside quiet hours falls back to the standard window.
  return { start: PREF_WINDOWS.unknown, minutes: DEFAULT_WINDOW_MINUTES, source: 'pref' };
}
