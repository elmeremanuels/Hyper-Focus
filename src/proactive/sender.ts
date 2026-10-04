// Sends due messages from scheduled_nudges (BOUWPLAN.md, 11.1): one row at a time with
// FOR UPDATE SKIP LOCKED, through the guardrails, then over the user's channel.
import { and, asc, desc, eq, gt, gte, lte, notInArray, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { Delivery } from '../channels/channel.js';
import type { InboundSource, OutboundMessage } from '../conversation/types.js';
import { recordEvent } from '../core/events.js';
import { getProfile } from '../core/profile.js';
import { getSettings, type UserSettingsRow } from '../core/settings.js';
import type { UserStore } from '../core/users.js';
import type { Database } from '../db/client.js';
import { events, scheduledNudges, users } from '../db/schema/index.js';
import { localDate, localNow } from '../lib/time.js';
import { composeWeeklyMail, reviewStart } from '../conversation/review.js';
import { composeCheckin } from '../conversation/session.js';
import { composeSoftLanding, composeWindowHeadsUp, composeWindowMissed, composeWindowQuietCheck } from '../conversation/focus-window.js';
import {
  activeBlock,
  BLOCK_NUDGE_KINDS,
  closeQuietly,
  composeBlockEnd,
  composeHyperfocusBreak,
  composeReturnReminder,
  SOUND_KINDS,
} from '../conversation/blocks.js';
import { checkGuardrails, silentDays, USER_STARTED_KINDS, type GuardrailInput, type GuardrailVerdict } from './guardrails.js';
import { composeFollowup, composeHeadsUp, composePlannedSession, todaysEvents } from './calendar-messages.js';
import { meetingAt } from './daycalendar.js';
import { composeEscalation } from './escalation.js';
import { composeMidday, composeMorning, composeMorningFollowup, composeReentry, composeWrapup, type Composed, type NudgeContext } from './messages.js';

export type NudgeRow = typeof scheduledNudges.$inferSelect;
export type Composer = (ctx: NudgeContext, nudge: NudgeRow) => Promise<Composed>;
export type Guardrail = (input: GuardrailInput) => GuardrailVerdict;

export const DEFAULT_COMPOSERS: Partial<Record<NudgeRow['kind'], Composer>> = {
  morning: (ctx, nudge) => composeMorning(ctx, String(nudge.payload.localDate)),
  midday: (ctx, nudge) => composeMidday(ctx, Number(nudge.payload.taskId)),
  wrapup: (ctx, nudge) => composeWrapup(ctx, String(nudge.payload.localDate)),
  session_checkin: (ctx, nudge) =>
    nudge.payload.planned
      ? composePlannedSession(ctx, Number(nudge.payload.taskId))
      : composeCheckin(ctx, { taskId: Number(nudge.payload.taskId), stepId: Number(nudge.payload.stepId) }),
  meeting_heads_up: (ctx, nudge) => composeHeadsUp(ctx, String(nudge.payload.eventId)),
  meeting_followup: (ctx, nudge) => composeFollowup(ctx, String(nudge.payload.eventId)),
  escalation: (ctx, nudge) => composeEscalation(ctx, Number(nudge.payload.taskId), Number(nudge.payload.level)),
  reentry: (ctx) => composeReentry(ctx),
  block_end: (ctx, nudge) => composeBlockEnd(ctx, Number(nudge.payload.blockId)),
  hyperfocus_break: (ctx, nudge) => composeHyperfocusBreak(ctx, Number(nudge.payload.blockId)),
  return_reminder: (ctx, nudge) => composeReturnReminder(ctx, Number(nudge.payload.blockId)),
  pause_close: (ctx, nudge) => closeQuietly(ctx, Number(nudge.payload.blockId), String(nudge.payload.phase)),
  window_heads_up: (ctx, nudge) => composeWindowHeadsUp(ctx, Number(nudge.payload.windowId)),
  window_quiet_check: (ctx, nudge) => composeWindowQuietCheck(ctx, Number(nudge.payload.blockId)),
  soft_landing: (ctx, nudge) =>
    composeSoftLanding(ctx, Number(nudge.payload.windowId), typeof nudge.payload.title === 'string' ? nudge.payload.title : null),
  window_missed: (ctx, nudge) => composeWindowMissed(ctx, Number(nudge.payload.windowId)),
  morning_followup: (ctx, nudge) => composeMorningFollowup(ctx, nudge.payload),
  weekly_review: async (ctx, nudge) =>
    nudge.payload.part === 'mail'
      ? { ...(await composeWeeklyMail(ctx)), mailOnly: true }
      : { subject: 'Weekreview', message: await reviewStart(ctx) },
};

export interface SenderDeps {
  /** Runs a queued message through the router again (verbeterplan P0.2). */
  retry?: (message: { userId: number; text: string; source: InboundSource }) => Promise<OutboundMessage[]>;
  db: Database;
  delivery: Delivery;
  users: Pick<UserStore, 'findById'>;
  composers?: Partial<Record<NudgeRow['kind'], Composer>>;
  guardrail?: Guardrail;
  log?: Pick<Console, 'error' | 'warn'>;
}

/** Heads-ups and follow-ups are about the appointment itself, so they never move. */
const MEETING_KINDS = new Set(['meeting_heads_up', 'meeting_followup']);
export const MAX_MEETING_DELAY_MS = 90 * 60 * 1000;

/** A message more than this late is skipped (worker was down). */
export const MAX_DELAY_MS = 2 * 60 * 60 * 1000;

export interface SendSummary {
  sent: number;
  skipped: number;
  failed: number;
  postponed: number;
}

export async function sendDueNudges(deps: SenderDeps, now: Date = new Date(), limit = 50): Promise<SendSummary> {
  const summary: SendSummary = { sent: 0, skipped: 0, failed: 0, postponed: 0 };
  for (let i = 0; i < limit; i++) {
    const status = await deps.db.transaction(async (tx) => {
      const [nudge] = await tx
        .select()
        .from(scheduledNudges)
        .where(and(eq(scheduledNudges.status, 'pending'), lte(scheduledNudges.scheduledForUtc, now)))
        .orderBy(asc(scheduledNudges.scheduledForUtc), asc(scheduledNudges.id))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!nudge) return undefined;

      const result = await processNudge(deps, nudge, now);
      if (result.status === 'postponed') {
        // Keep the first planned time: the 90-minute limit counts from there.
        const payload = { ...nudge.payload, originalAt: nudge.payload.originalAt ?? nudge.scheduledForUtc.toISOString() };
        await tx.update(scheduledNudges).set({ scheduledForUtc: result.retryAt, payload }).where(eq(scheduledNudges.id, nudge.id));
        return 'postponed' as const;
      }
      // updated_at doubles as the send time for the daily limit and breathing room.
      await tx
        .update(scheduledNudges)
        .set({ status: result.status, skipReason: result.reason ?? null, updatedAt: now })
        .where(eq(scheduledNudges.id, nudge.id));
      if (result.status === 'skipped') {
        await recordEvent(deps.db, nudge.userId, 'nudge_skipped', { kind: nudge.kind, reason: result.reason });
      }
      return result.status;
    });
    if (status === undefined) break;
    summary[status] += 1;
  }
  return summary;
}

const SAME_MINUTE_MS = 60_000;
/** A queued message is tried for this long, then the user is asked to send it again. */
export const AI_RETRY_GIVE_UP_MS = 12 * 3_600_000;
const AI_RETRY_EVERY_MS = 10 * 60_000;

/** A message the AI could not read yet: through the router again, or give up after 12 hours. */
async function composeRetry(deps: SenderDeps, ctx: NudgeContext, nudge: NudgeRow): Promise<Composed> {
  const text = String(nudge.payload.text ?? '');
  const receivedAt = new Date(String(nudge.payload.receivedAt ?? nudge.createdAt.toISOString()));
  if (ctx.now.getTime() - receivedAt.getTime() > AI_RETRY_GIVE_UP_MS) {
    const when = DateTime.fromJSDate(receivedAt, { zone: ctx.timezone }).setLocale('nl').toFormat('cccc HH:mm');
    return { subject: 'Je bericht', message: { text: `Je bericht van ${when} kon ik niet verwerken. Wil je het opnieuw sturen?\n"${text.slice(0, 80)}"` } };
  }
  if (!deps.retry) return { retryAt: new Date(ctx.now.getTime() + AI_RETRY_EVERY_MS) };
  try {
    const source = (nudge.payload.source as InboundSource | undefined) ?? 'telegram';
    const [first, ...rest] = await deps.retry({ userId: ctx.userId, text, source });
    if (!first) return { skip: 'no_reply' };
    return { subject: 'Je bericht', message: first, ...(rest.length > 0 && { followUps: rest }) };
  } catch {
    return { retryAt: new Date(ctx.now.getTime() + AI_RETRY_EVERY_MS) };
  }
}
const FOLLOWUP_MAX_DELAY_MS = 30 * 60_000;

type NudgeResult =
  | { status: 'sent' | 'skipped' | 'failed'; reason?: string }
  | { status: 'postponed'; retryAt: Date };

async function processNudge(deps: SenderDeps, nudge: NudgeRow, now: Date): Promise<NudgeResult> {
  const log = deps.log ?? console;
  try {
    if (now.getTime() - nudge.scheduledForUtc.getTime() > MAX_DELAY_MS) return { status: 'skipped', reason: 'too_late' };
    // The morning follow-up belongs with the morning message; hours later it only gets in the way.
    if (nudge.kind === 'morning_followup' && now.getTime() - nudge.scheduledForUtc.getTime() > FOLLOWUP_MAX_DELAY_MS) {
      return { status: 'skipped', reason: 'too_late' };
    }

    // One query at a time: inside a transaction (sim:day) all queries share one connection.
    const user = await deps.users.findById(nudge.userId);
    const profile = await getProfile(deps.db, nudge.userId);
    const settings = await getSettings(deps.db, nudge.userId);
    const status = await deps.db
      .select({ status: users.status, lastInboundAt: users.lastInboundAt })
      .from(users)
      .where(eq(users.id, nudge.userId));
    if (!user || !profile) return { status: 'skipped', reason: 'unknown_user' };
    if (status[0]?.status === 'paused' && !USER_STARTED_KINDS.has(nudge.kind)) {
      return { status: 'skipped', reason: 'user_paused' };
    }

    // In an appointment: move to right after it, or drop after 90 minutes (BOUWPLAN.md, 11.8).
    if (!MEETING_KINDS.has(nudge.kind)) {
      const meeting = meetingAt(await todaysEvents({ db: deps.db, userId: user.id, timezone: profile.timezone, now }), now);
      if (meeting) {
        const original = new Date(String(nudge.payload.originalAt ?? nudge.scheduledForUtc.toISOString()));
        if (meeting.endsAt.getTime() - original.getTime() > MAX_MEETING_DELAY_MS) return { status: 'skipped', reason: 'in_meeting' };
        return { status: 'postponed', retryAt: meeting.endsAt };
      }
    }

    // During a work block or pause other messages wait until after the pause (step 1.9).
    const focus = await activeBlock(deps.db, user.id, now);
    if (focus && !BLOCK_NUDGE_KINDS.has(nudge.kind) && nudge.kind !== 'session_checkin') {
      return { status: 'postponed', retryAt: new Date(now.getTime() + 10 * 60_000) };
    }

    // Never two messages in the same minute (verbeterplan P0.1): the second waits two minutes.
    const [justSent] = await deps.db
      .select({ id: scheduledNudges.id })
      .from(scheduledNudges)
      .where(and(eq(scheduledNudges.userId, user.id), eq(scheduledNudges.status, 'sent'), gt(scheduledNudges.updatedAt, new Date(now.getTime() - SAME_MINUTE_MS))))
      .limit(1);
    if (justSent) return { status: 'postponed', retryAt: new Date(now.getTime() + 2 * SAME_MINUTE_MS) };

    const silent = silentDays(status[0]?.lastInboundAt ?? null, profile.timezone, now);
    const input = await guardrailInput(deps.db, nudge, now, profile.timezone, settings, silent);
    const verdict = (deps.guardrail ?? checkGuardrails)(input);
    if (!verdict.send) {
      return verdict.retryAt ? { status: 'postponed', retryAt: verdict.retryAt } : { status: 'skipped', reason: verdict.reason };
    }

    const composer = nudge.kind === 'ai_retry' ? (c: NudgeContext) => composeRetry(deps, c, nudge) : (deps.composers ?? DEFAULT_COMPOSERS)[nudge.kind];
    if (!composer) return { status: 'failed', reason: 'no_composer' };
    const ctx: NudgeContext = {
      db: deps.db,
      userId: user.id,
      name: profile.name,
      timezone: profile.timezone,
      now,
      silentDays: silent,
    };
    const composed = await composer(ctx, nudge);
    if ('skip' in composed) return { status: 'skipped', reason: composed.skip };
    if ('retryAt' in composed) return { status: 'postponed', retryAt: composed.retryAt };

    // Transitions make a sound; anything else during a block or pause is silent.
    const quiet = composed.silent === true || (Boolean(focus) && !SOUND_KINDS.has(nudge.kind));
    const via = await deps.delivery.send(user, composed.message, {
      ...(composed.mailOnly && { via: 'email' as const }),
      context: { subject: composed.subject, silent: quiet },
    });
    // Follow-ups only in Telegram; by mail they would be a second mail.
    for (const followUp of via === 'telegram' ? (composed.followUps ?? []) : []) {
      await deps.delivery.send(user, followUp, { via, context: { subject: composed.subject, silent: quiet } });
    }
    // Follow-ups such as the morning question: Telegram only, at their own time.
    if (via === 'telegram' && composed.later?.length) {
      await deps.db.insert(scheduledNudges).values(
        composed.later.map((item) => ({
          userId: user.id,
          kind: item.kind,
          scheduledForUtc: new Date(now.getTime() + item.afterMinutes * 60_000),
          payload: item.payload,
        })),
      );
    }
    if (composed.alsoByMail && via !== 'email') {
      await deps.delivery.send(user, composed.message, { via: 'email', context: { subject: composed.subject } });
    }
    return { status: 'sent' };
  } catch (error) {
    log.error(`Nudge ${nudge.id} (${nudge.kind}) failed:`, error);
    return { status: 'failed', reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown' };
  }
}

async function guardrailInput(
  db: Database,
  nudge: NudgeRow,
  now: Date,
  timezone: string,
  settings: UserSettingsRow,
  silent: number,
): Promise<GuardrailInput> {
  const dayStart = localNow(timezone, now).startOf('day').toJSDate();
  const yesterday = localDate(timezone, localNow(timezone, now).minus({ days: 1 }).toJSDate());
  const proactive = and(
    eq(scheduledNudges.userId, nudge.userId),
    eq(scheduledNudges.status, 'sent'),
    notInArray(scheduledNudges.kind, [
      'session_checkin',
      'meeting_heads_up',
      'meeting_followup',
      'block_end',
      'return_reminder',
      'pause_close',
      'hyperfocus_break',
      'window_quiet_check',
      'soft_landing',
      'window_missed',
      'morning_followup',
      'ai_retry',
    ]),
    // The Monday mail does not count against Telegram messages.
    sql`not (${scheduledNudges.kind} = 'weekly_review' and ${scheduledNudges.payload}->>'part' = 'mail')`,
  );

  const today = await db
    .select({ id: scheduledNudges.id })
    .from(scheduledNudges)
    .where(and(proactive, gte(scheduledNudges.updatedAt, dayStart)));
  const lastRows = await db
    .select({ at: scheduledNudges.updatedAt })
    .from(scheduledNudges)
    .where(and(proactive, lte(scheduledNudges.updatedAt, now)))
    .orderBy(desc(scheduledNudges.updatedAt))
    .limit(1);
  const overwhelm = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.userId, nudge.userId), eq(events.name, 'overwhelm'), sql`${events.props}->>'date' = ${yesterday}`))
    .limit(1);
  const [last] = lastRows;

  return {
    kind: nudge.kind,
    now,
    timezone,
    settings: {
      pausedUntil: settings.pausedUntil,
      quietStart: settings.quietStart,
      quietEnd: settings.quietEnd,
      maxProactivePerDay: settings.maxProactivePerDay,
    },
    sentToday: today.length,
    lastProactiveAt: last?.at ?? null,
    silentDays: silent,
    overwhelmedYesterday: overwhelm.length > 0,
    mailOnly: nudge.kind === 'weekly_review' && nudge.payload.part === 'mail',
  };
}
