// Checks a proactive message before it goes out (BOUWPLAN.md, 11.6). Pure: the sender
// gathers the facts, this decides.
import { DateTime } from 'luxon';

/** The user started these themselves, so they go out regardless of the guardrails. */
export const USER_STARTED_KINDS = new Set(['session_checkin']);
/** Heads-ups and follow-ups: limited by max_calendar_nudges_per_day when planned. */
export const CALENDAR_KINDS = new Set(['meeting_heads_up', 'meeting_followup']);
/** At least this long between two proactive messages. */
export const BREATHING_MINUTES = 45;

export interface GuardrailInput {
  kind: string;
  now: Date;
  timezone: string;
  settings: {
    pausedUntil: Date | null;
    quietStart: string;
    quietEnd: string;
    maxProactivePerDay: number;
  };
  /** Proactive messages sent on the user's local today (session check-ins excluded). */
  sentToday: number;
  /** The last proactive message, any day. */
  lastProactiveAt: Date | null;
  /** Local days since the user last wrote; 0 when they wrote today. */
  silentDays: number;
  /** The user signalled overwhelm on the previous local day. */
  overwhelmedYesterday: boolean;
  /** Goes by mail only (the Monday overview): no daily limit or breathing room. */
  mailOnly?: boolean;
}

export type GuardrailVerdict =
  | { send: true }
  | { send: false; reason: string; retryAt?: Date };

export function checkGuardrails(input: GuardrailInput): GuardrailVerdict {
  if (USER_STARTED_KINDS.has(input.kind)) return { send: true };

  const { settings, now } = input;
  if (settings.pausedUntil && settings.pausedUntil > now) return { send: false, reason: 'paused' };
  if (isQuiet(input.timezone, now, settings.quietStart, settings.quietEnd)) return { send: false, reason: 'quiet_hours' };

  // Withdrawing on silence: 2 days → morning only · 4 days → silent · day 7 → one restart.
  if (input.kind === 'reentry') {
    if (input.silentDays < 7) return { send: false, reason: 'not_silent' };
  } else if (input.silentDays >= 4) {
    return { send: false, reason: 'silence' };
  } else if (input.silentDays >= 2 && input.kind !== 'morning') {
    return { send: false, reason: 'silence_morning_only' };
  }

  // Mail and appointment messages have their own limits (BOUWPLAN.md, 11.7–11.8).
  if (input.mailOnly || CALENDAR_KINDS.has(input.kind)) return { send: true };

  const limit = input.overwhelmedYesterday ? 1 : settings.maxProactivePerDay;
  if (input.sentToday >= limit) {
    return { send: false, reason: input.overwhelmedYesterday ? 'after_overwhelm' : 'daily_limit' };
  }

  if (input.lastProactiveAt) {
    const next = input.lastProactiveAt.getTime() + BREATHING_MINUTES * 60_000;
    if (next > now.getTime()) return { send: false, reason: 'breathing_room', retryAt: new Date(next) };
  }
  return { send: true };
}

/** Quiet hours wrap around midnight (21:00–08:00 by default). */
export function isQuiet(timezone: string, now: Date, start: string, end: string): boolean {
  const local = DateTime.fromJSDate(now, { zone: timezone }).toFormat('HH:mm');
  const from = start.slice(0, 5);
  const to = end.slice(0, 5);
  return from <= to ? local >= from && local < to : local >= from || local < to;
}

/** Local calendar days between the last inbound message and now. */
export function silentDays(lastInboundAt: Date | null, timezone: string, now: Date): number {
  if (!lastInboundAt) return 0;
  const last = DateTime.fromJSDate(lastInboundAt, { zone: timezone }).startOf('day');
  const today = DateTime.fromJSDate(now, { zone: timezone }).startOf('day');
  return Math.max(0, Math.round(today.diff(last, 'days').days));
}
