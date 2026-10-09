import { DateTime } from 'luxon';

// All times are stored in UTC and computed per user in their IANA timezone (BOUWPLAN.md, 11.1).

export function localNow(timezone: string, now: Date = new Date()): DateTime {
  return DateTime.fromJSDate(now, { zone: timezone });
}

/** The user's local calendar date as YYYY-MM-DD. */
export function localDate(timezone: string, now: Date = new Date()): string {
  return localNow(timezone, now).toISODate() ?? '';
}

/** Start of the given local date (YYYY-MM-DD) in the user's timezone, as a UTC Date. */
export function startOfLocalDate(timezone: string, date: string): Date {
  return DateTime.fromISO(date, { zone: timezone }).startOf('day').toUTC().toJSDate();
}

/** Start of the next local day, as a UTC Date. */
export function startOfNextLocalDay(timezone: string, now: Date = new Date()): Date {
  return localNow(timezone, now).plus({ days: 1 }).startOf('day').toUTC().toJSDate();
}

/** "HH:MM" or "HH:MM:SS" on a local date, as a UTC Date. */
export function localTimeOnDate(timezone: string, date: string, time: string): Date {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return DateTime.fromISO(date, { zone: timezone }).set({ hour, minute, second: 0, millisecond: 0 }).toUTC().toJSDate();
}

const WEEKDAYS = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];

/** "woensdag 1 oktober 2026, 10:30". */
export function describeLocal(timezone: string, now: Date = new Date()): string {
  const local = localNow(timezone, now).setLocale('nl');
  return `${WEEKDAYS[local.weekday - 1]} ${local.toFormat('d LLLL yyyy, HH:mm')}`;
}

export function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && DateTime.fromISO(value).isValid;
}

export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
