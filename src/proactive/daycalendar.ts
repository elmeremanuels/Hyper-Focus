// Free time on a day with appointments (BOUWPLAN.md, 11.8). Pure, so easy to test.
import { DateTime } from 'luxon';

export interface DayEvent {
  startsAt: Date;
  endsAt: Date;
  title: string;
  isBusy: boolean;
  isAllDay: boolean;
}

export interface Block {
  start: Date;
  end: Date;
}

/** Days with at least this much busy time get at most two focus tasks. */
export const BUSY_DAY_MINUTES = 240;

const minutes = (block: Block) => (block.end.getTime() - block.start.getTime()) / 60_000;

/** Busy timed events, clipped to the window and merged. All-day and free events leave time free. */
export function busyBlocks(events: DayEvent[], from: Date, to: Date): Block[] {
  const clipped = events
    .filter((e) => e.isBusy && !e.isAllDay && e.endsAt > from && e.startsAt < to)
    .map((e) => ({ start: new Date(Math.max(e.startsAt.getTime(), from.getTime())), end: new Date(Math.min(e.endsAt.getTime(), to.getTime())) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Block[] = [];
  for (const block of clipped) {
    const last = merged.at(-1);
    if (last && block.start <= last.end) last.end = new Date(Math.max(last.end.getTime(), block.end.getTime()));
    else merged.push({ ...block });
  }
  return merged;
}

export function freeBlocks(from: Date, to: Date, busy: Block[]): Block[] {
  const free: Block[] = [];
  let cursor = from;
  for (const block of busy) {
    if (block.start > cursor) free.push({ start: cursor, end: block.start });
    if (block.end > cursor) cursor = block.end;
  }
  if (cursor < to) free.push({ start: cursor, end: to });
  return free;
}

export function totalMinutes(blocks: Block[]): number {
  return blocks.reduce((sum, block) => sum + minutes(block), 0);
}

/** The first free block of at least `length` minutes, if any. */
export function firstFreeSlot(from: Date, to: Date, events: DayEvent[], length: number): Block | undefined {
  return freeBlocks(from, to, busyBlocks(events, from, to)).find((block) => minutes(block) >= length);
}

/** The busy event covering `at`, if any. */
export function meetingAt(events: DayEvent[], at: Date): DayEvent | undefined {
  return events.find((e) => e.isBusy && !e.isAllDay && e.startsAt <= at && e.endsAt > at);
}

const NUMBERS = ['Geen', 'Eén', 'Twee', 'Drie', 'Vier', 'Vijf', 'Zes'];

/**
 * One line for the morning message: "Twee afspraken vandaag, de eerste om 10:00. Tussen
 * 13:00 en 15:00 heb je ruimte." All-day events are named.
 */
export function daySummary(events: DayEvent[], timezone: string, from: Date, to: Date, localDate: string): string | undefined {
  const time = (d: Date) => DateTime.fromJSDate(d, { zone: timezone }).toFormat('HH:mm');
  const day = new Date(`${localDate}T00:00:00Z`);
  const allDay = events.filter((e) => e.isAllDay && e.startsAt <= day && e.endsAt > day);
  const timed = events
    .filter((e) => e.isBusy && !e.isAllDay && e.endsAt > from && e.startsAt < to)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  const parts: string[] = [];
  if (allDay.length > 0) parts.push(`Vandaag: ${allDay.map((e) => e.title).join(', ')}.`);
  if (timed.length > 0) {
    const count = timed.length === 1 ? 'Eén afspraak' : `${NUMBERS[timed.length] ?? timed.length} afspraken`;
    const first = timed[0] as DayEvent;
    parts.push(`${count} vandaag, ${timed.length === 1 ? 'om' : 'de eerste om'} ${time(first.startsAt)}.`);
    const longest = freeBlocks(from, to, busyBlocks(events, from, to)).sort((a, b) => minutes(b) - minutes(a))[0];
    if (longest && minutes(longest) >= 30) parts.push(`Tussen ${time(longest.start)} en ${time(longest.end)} heb je ruimte.`);
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}

/**
 * Fits the focus to the free time (BOUWPLAN.md, 11.8): on a busy day (≥ 4 hours of
 * appointments) or when the estimate does not fit, the third task goes first. When it
 * still does not fit, the main task shrinks to its first micro step (done by the caller).
 */
export function fitFocus(
  picked: Array<{ id: number; estimatedMinutes: number | null }>,
  freeMinutes: number,
  busyMinutes: number,
): { taskIds: number[]; shrinkMain: boolean } {
  const total = (list: typeof picked) => list.reduce((sum, t) => sum + (t.estimatedMinutes ?? 30), 0);
  let list = picked;
  if (list.length > 2 && (busyMinutes >= BUSY_DAY_MINUTES || total(list) > freeMinutes)) list = list.slice(0, 2);
  return { taskIds: list.map((t) => t.id), shrinkMain: total(list) > freeMinutes };
}
