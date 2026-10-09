// The focus log and the weekly yield (step 1.12, A3). The log is a query on focus_blocks:
// only finished blocks (completed or extended), and it only grows.
import { and, asc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { Database } from '../db/client.js';
import { focusBlocks, focusWindows, tasks } from '../db/schema/index.js';
import { BLOCK_TEXTS, fill } from '../texts/werkblokken.nl.js';
import { WEEKDAY_NAMES } from '../texts/focusvenster.nl.js';

export interface FocusLogLine {
  blockId: number;
  startedAt: Date;
  /** Local start, HH:MM, and the short weekday ("Di"). */
  time: string;
  day: string;
  minutes: number;
  title: string;
  /** What got done, when something got done. */
  result: string | null;
  inWindow: boolean;
}

const SHORT_DAYS = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];

export async function focusLog(db: Database, userId: number, timezone: string, from: Date, to: Date): Promise<FocusLogLine[]> {
  const rows = await db
    .select({
      id: focusBlocks.id,
      startedAt: focusBlocks.startedAt,
      endedAt: focusBlocks.endedAt,
      inWindow: focusBlocks.inWindow,
      resultNote: focusBlocks.resultNote,
      taskTitle: tasks.title,
    })
    .from(focusBlocks)
    .leftJoin(tasks, eq(tasks.id, focusBlocks.taskId))
    .where(
      and(
        eq(focusBlocks.userId, userId),
        inArray(focusBlocks.outcome, ['completed', 'extended']),
        isNotNull(focusBlocks.endedAt),
        gte(focusBlocks.startedAt, from),
        lt(focusBlocks.startedAt, to),
      ),
    )
    .orderBy(asc(focusBlocks.startedAt), asc(focusBlocks.id));
  return rows.map((row) => {
    const start = DateTime.fromJSDate(row.startedAt, { zone: timezone });
    return {
      blockId: row.id,
      startedAt: row.startedAt,
      time: start.toFormat('HH:mm'),
      day: SHORT_DAYS[start.weekday - 1] ?? '',
      minutes: Math.max(1, Math.round(((row.endedAt ?? row.startedAt).getTime() - row.startedAt.getTime()) / 60_000)),
      title: row.taskTitle ?? 'Blok',
      result: row.resultNote,
      inWindow: row.inWindow,
    };
  });
}

/** "Di 10:30 · 82 min · Offerte Boho af", with ■ for a block in the focus window. */
export function formatLogLine(line: FocusLogLine): string {
  return `${line.inWindow ? '■ ' : ''}${line.day} ${line.time} · ${line.minutes} min · ${line.result ?? line.title}`;
}

export function todayRange(timezone: string, now: Date): { from: Date; to: Date } {
  const start = DateTime.fromJSDate(now, { zone: timezone }).startOf('day');
  return { from: start.toJSDate(), to: start.plus({ days: 1 }).toJSDate() };
}

// ---------------------------------------------------------------------------
// Weekly yield

const KINDS: Record<string, [string, string]> = {
  offerte: ['offerte', 'offertes'],
  factuur: ['factuur', 'facturen'],
  email: ['mail', 'mails'],
  calendar: ['afspraak', 'afspraken'],
  content: ['post', 'posts'],
  website: ['pagina', "pagina's"],
  docs: ['document', 'documenten'],
};
const ORDER = ['offerte', 'factuur', 'email', 'content', 'website', 'docs', 'calendar'];

/** "3 uur", "4,5 uur": rounded to half hours, at least half an hour. */
export function hoursLabel(minutes: number): string {
  const half = Math.max(1, Math.round(minutes / 30)) / 2;
  return Number.isInteger(half) ? String(half) : String(half).replace('.', ',');
}

/** At most three lines, only with what is there (step 1.12, A3). */
export async function weekYield(db: Database, userId: number, timezone: string, now: Date): Promise<string[]> {
  const from = new Date(now.getTime() - 7 * 86_400_000);
  const log = await focusLog(db, userId, timezone, from, now);
  const [windows] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(focusWindows)
    .where(and(eq(focusWindows.userId, userId), eq(focusWindows.status, 'used'), gte(focusWindows.startsAt, from)));
  const lines: string[] = [];
  const minutes = log.reduce((sum, line) => sum + line.minutes, 0);
  if (minutes > 0) lines.push(fill(BLOCK_TEXTS.weekYield, { v: windows?.n ?? 0, u: hoursLabel(minutes) }));

  // Done per kind of work; invoicing splits on the word offerte or factuur in the title.
  const done = await db
    .select({ title: tasks.title, workType: tasks.workType })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.status, 'done'), isNotNull(tasks.workType), gte(tasks.completedAt, from)));
  const counts = new Map<string, number>();
  for (const task of done) {
    const kind = task.workType === 'invoicing' ? (/offerte/i.test(task.title) ? 'offerte' : 'factuur') : (task.workType ?? '');
    if (KINDS[kind]) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const parts = ORDER.filter((kind) => counts.get(kind)).map((kind) => {
    const n = counts.get(kind) ?? 0;
    const [one, many] = KINDS[kind] ?? ['', ''];
    return `${n} ${n === 1 ? one : many}`;
  });
  if (parts.length > 0) lines.push(fill(BLOCK_TEXTS.weekOut, { lijst: parts.join(', ') }));

  const best = log.filter((line) => line.inWindow).sort((a, b) => b.minutes - a.minutes)[0];
  if (best) {
    const day = DateTime.fromJSDate(best.startedAt, { zone: timezone });
    lines.push(fill(BLOCK_TEXTS.weekBest, { dag: WEEKDAY_NAMES[day.weekday - 1] ?? '', tijd: best.time, n: best.minutes }));
  }
  return lines;
}
