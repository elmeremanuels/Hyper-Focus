// Sends due messages from scheduled_nudges (BOUWPLAN.md, 11.1): one row at a time with
// FOR UPDATE SKIP LOCKED, through the guardrails, then over the user's channel.
import { and, asc, eq, lte } from 'drizzle-orm';
import type { Delivery } from '../channels/channel.js';
import { recordEvent } from '../core/events.js';
import { getProfile } from '../core/profile.js';
import { getSettings, type UserSettingsRow } from '../core/settings.js';
import type { UserStore } from '../core/users.js';
import type { Database } from '../db/client.js';
import { scheduledNudges } from '../db/schema/index.js';
import { composeCheckin } from '../conversation/session.js';
import { checkGuardrails, type GuardrailVerdict } from './guardrails.js';
import { composeMidday, composeMorning, composeWrapup, type Composed, type NudgeContext } from './messages.js';

export type NudgeRow = typeof scheduledNudges.$inferSelect;
export type Composer = (ctx: NudgeContext, nudge: NudgeRow) => Promise<Composed>;
export type Guardrail = (input: {
  nudge: NudgeRow;
  now: Date;
  settings: UserSettingsRow;
  timezone: string;
}) => Promise<GuardrailVerdict> | GuardrailVerdict;

export const DEFAULT_COMPOSERS: Partial<Record<NudgeRow['kind'], Composer>> = {
  morning: (ctx, nudge) => composeMorning(ctx, String(nudge.payload.localDate)),
  midday: (ctx, nudge) => composeMidday(ctx, Number(nudge.payload.taskId)),
  wrapup: (ctx, nudge) => composeWrapup(ctx, String(nudge.payload.localDate)),
  session_checkin: (ctx, nudge) =>
    composeCheckin(ctx, { taskId: Number(nudge.payload.taskId), stepId: Number(nudge.payload.stepId) }),
};

export interface SenderDeps {
  db: Database;
  delivery: Delivery;
  users: Pick<UserStore, 'findById'>;
  composers?: Partial<Record<NudgeRow['kind'], Composer>>;
  guardrail?: Guardrail;
  log?: Pick<Console, 'error' | 'warn'>;
}

/** A message more than this late is skipped (worker was down). */
export const MAX_DELAY_MS = 2 * 60 * 60 * 1000;

export interface SendSummary {
  sent: number;
  skipped: number;
  failed: number;
}

export async function sendDueNudges(deps: SenderDeps, now: Date = new Date(), limit = 50): Promise<SendSummary> {
  const summary: SendSummary = { sent: 0, skipped: 0, failed: 0 };
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
      await tx
        .update(scheduledNudges)
        .set({ status: result.status, skipReason: result.reason ?? null })
        .where(eq(scheduledNudges.id, nudge.id));
      if (result.status === 'skipped') {
        await recordEvent(deps.db, nudge.userId, 'nudge_skipped', { kind: nudge.kind, reason: result.reason });
      }
      return result.status;
    });
    if (status === undefined) break;
    summary[status === 'sent' ? 'sent' : status === 'skipped' ? 'skipped' : 'failed'] += 1;
  }
  return summary;
}

interface NudgeResult {
  status: 'sent' | 'skipped' | 'failed';
  reason?: string;
}

async function processNudge(deps: SenderDeps, nudge: NudgeRow, now: Date): Promise<NudgeResult> {
  const log = deps.log ?? console;
  try {
    if (now.getTime() - nudge.scheduledForUtc.getTime() > MAX_DELAY_MS) return { status: 'skipped', reason: 'too_late' };

    const [user, profile, settings] = await Promise.all([
      deps.users.findById(nudge.userId),
      getProfile(deps.db, nudge.userId),
      getSettings(deps.db, nudge.userId),
    ]);
    if (!user || !profile) return { status: 'skipped', reason: 'unknown_user' };

    const verdict = deps.guardrail
      ? await deps.guardrail({ nudge, now, settings, timezone: profile.timezone })
      : checkGuardrails({ kind: nudge.kind, now, settings });
    if (!verdict.send) return { status: 'skipped', reason: verdict.reason };

    const composer = (deps.composers ?? DEFAULT_COMPOSERS)[nudge.kind];
    if (!composer) return { status: 'failed', reason: 'no_composer' };
    const composed = await composer({ db: deps.db, userId: user.id, name: profile.name, timezone: profile.timezone, now }, nudge);
    if ('skip' in composed) return { status: 'skipped', reason: composed.skip };

    await deps.delivery.send(user, composed.message, { context: { subject: composed.subject } });
    return { status: 'sent' };
  } catch (error) {
    log.error(`Nudge ${nudge.id} (${nudge.kind}) failed:`, error);
    return { status: 'failed', reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown' };
  }
}
