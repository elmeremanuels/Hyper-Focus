// The work week (step 1.12): which days and hours someone works. Pure helpers.
// The weekly review falls on the last work day of the week, at the end of the work day.

export const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5];
const SHORT = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
const LONG = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];

/** Sorted, unique ISO weekdays; an empty list falls back to Monday to Friday. */
export function normalizeDays(days: readonly number[] | null | undefined): number[] {
  const clean = [...new Set((days ?? []).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b);
  return clean.length > 0 ? clean : DEFAULT_WORK_DAYS;
}

export const isWorkday = (days: readonly number[], weekday: number) => normalizeDays(days).includes(weekday);
/** The last work day of the week: the weekly review, the rhythm proposal and the week's yield. */
export const lastWorkday = (days: readonly number[]) => normalizeDays(days).at(-1) ?? 5;
/** The first work day of the week: the Monday mail moves along. */
export const firstWorkday = (days: readonly number[]) => normalizeDays(days)[0] ?? 1;
export const dayName = (weekday: number) => LONG[weekday - 1] ?? '';

/** "ma t/m vr", "ma, di en do", "di t/m za". */
export function describeDays(days: readonly number[]): string {
  const list = normalizeDays(days);
  const consecutive = list.every((d, i) => i === 0 || d === (list[i - 1] ?? 0) + 1);
  if (list.length >= 3 && consecutive) return `${SHORT[(list[0] ?? 1) - 1]} t/m ${SHORT[(list.at(-1) ?? 5) - 1]}`;
  const names = list.map((d) => SHORT[d - 1] ?? '');
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} en ${names.at(-1)}`;
}

/** Parses "1,2,3,4,5" or "12345" from a button. */
export function parseDays(value: string): number[] {
  return normalizeDays([...value.replace(/\D/g, '')].map(Number));
}
