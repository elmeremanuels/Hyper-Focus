// The battery for the dashboard (step 1.12, A4): which state someone is in around their focus
// window. Pure, so every state and transition is easy to test. There is no empty or red state.
import { DateTime } from 'luxon';

export type BatteryStateName = 'charging' | 'ready' | 'focus' | 'pitstop' | 'idle';

export interface BatteryWindow {
  startsAt: Date;
  endsAt: Date;
  status: 'planned' | 'used' | 'missed' | 'moved';
  source: 'pref' | 'learned' | 'manual';
  task: { id: number; title: string } | null;
  confidence: number | null;
}

export interface BatteryBlock {
  phase: 'block' | 'pause';
  startedAt: Date;
  inWindow: boolean;
  pauseStartedAt: Date | null;
  pauseDueAt: Date | null;
}

export interface BatteryEvent {
  kind: 'small_task_done' | 'pitstop_done';
  at: Date;
}

export interface BatteryInput {
  now: Date;
  timezone: string;
  /** Today's window, if any. */
  window: BatteryWindow | undefined;
  /** The next window after today's, for the idle label. */
  nextWindow: Pick<BatteryWindow, 'startsAt' | 'endsAt'> | undefined;
  activeBlock: BatteryBlock | undefined;
  recentEvents: BatteryEvent[];
  /** The segments of the last active state; idle shows them dimmed. */
  lastSegments: number;
}

export interface BatteryState {
  state: BatteryStateName;
  /** 1–4; never 0. */
  segments: number;
  dimmed: boolean;
  windowStartsAt: string | null;
  windowEndsAt: string | null;
  task: { id: number; title: string } | null;
  source: 'pref' | 'learned' | 'manual' | null;
  confidence: number | null;
  /** Minutes in focus, for the focus state. */
  elapsedMinutes: number | null;
  /** For screen readers. */
  label: string;
}

/** The battery charges in the hour before the window. */
export const CHARGING_MINUTES = 60;
const MAX = 4;
const clamp = (n: number) => Math.max(1, Math.min(MAX, n));
const minutesBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000;
const DAYS = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];

export function batteryState(input: BatteryInput): BatteryState {
  const { now, timezone, window, activeBlock } = input;
  const iso = (d: Date) => DateTime.fromJSDate(d, { zone: timezone }).toISO({ suppressMilliseconds: true });
  const time = (d: Date) => DateTime.fromJSDate(d, { zone: timezone }).toFormat('HH:mm');
  const open = window && (window.status === 'planned' || window.status === 'used') ? window : undefined;
  const base = {
    dimmed: false,
    windowStartsAt: open ? iso(open.startsAt) : null,
    windowEndsAt: open ? iso(open.endsAt) : null,
    task: open?.task ?? null,
    source: open?.source ?? null,
    confidence: open?.confidence ?? null,
    elapsedMinutes: null,
  };

  if (activeBlock?.phase === 'pause' && activeBlock.pauseStartedAt && activeBlock.pauseDueAt) {
    const total = Math.max(1, minutesBetween(activeBlock.pauseStartedAt, activeBlock.pauseDueAt));
    const done = Math.min(1, Math.max(0, minutesBetween(activeBlock.pauseStartedAt, now) / total));
    return { ...base, state: 'pitstop', segments: clamp(2 + Math.floor(done * 2)), label: `Pitstop, terug om ${time(activeBlock.pauseDueAt)}` };
  }
  if (activeBlock?.phase === 'block') {
    const elapsed = Math.max(0, Math.floor(minutesBetween(activeBlock.startedAt, now)));
    return { ...base, state: 'focus', segments: MAX, elapsedMinutes: elapsed, label: `In focus, ${elapsed} minuten` };
  }
  if (open && now >= open.startsAt && now < open.endsAt) {
    const task = open.task ? ` ${open.task.title} ligt klaar` : '';
    return { ...base, state: 'ready', segments: MAX, label: `Focusvenster begint.${task}`.trim() };
  }
  if (open && open.status === 'planned' && now < open.startsAt && minutesBetween(now, open.startsAt) <= CHARGING_MINUTES) {
    const left = Math.ceil(minutesBetween(now, open.startsAt));
    const byTime = MAX - Math.floor((left - 1) / 15);
    const hourStart = new Date(open.startsAt.getTime() - CHARGING_MINUTES * 60_000);
    const bonus = input.recentEvents.filter((e) => e.at >= hourStart && e.at <= now).length;
    return { ...base, state: 'charging', segments: clamp(byTime + bonus), label: `Focusvenster over ${left} minuten` };
  }

  // Idle: the last state, dimmed, with the next window.
  const next = open && open.startsAt > now ? open : input.nextWindow;
  const label = next ? `Volgend focusvenster ${dayLabel(next.startsAt, now, timezone)} ${time(next.startsAt)}` : 'Geen focusvenster gepland';
  return {
    ...base,
    windowStartsAt: next ? iso(next.startsAt) : null,
    windowEndsAt: next ? iso(next.endsAt) : null,
    task: next === open ? (open?.task ?? null) : null,
    state: 'idle',
    segments: clamp(input.lastSegments),
    dimmed: true,
    label,
  };
}

function dayLabel(at: Date, now: Date, timezone: string): string {
  const day = DateTime.fromJSDate(at, { zone: timezone }).startOf('day');
  const today = DateTime.fromJSDate(now, { zone: timezone }).startOf('day');
  const diff = Math.round(day.diff(today, 'days').days);
  if (diff === 0) return 'vandaag';
  if (diff === 1) return 'morgen';
  return DAYS[day.weekday - 1] ?? '';
}
