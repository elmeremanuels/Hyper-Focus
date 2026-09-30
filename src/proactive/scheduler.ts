// Harvested from Publicato-personal:
// - runJobWithMetrics from server/services/cronService.ts (unchanged)
// - per-user nextRun / run registration / retry pattern from server/cron/aiAutopilotRunner.ts
// Changed: the fixed Europe/Amsterdam timezone is replaced by a timezone per user,
// storage is an interface (the database arrives in step 0.4), and the cron job is a
// one-minute tick (BOUWPLAN.md, 11.1).
import cron, { type ScheduledTask } from 'node-cron';
import { DateTime } from 'luxon';
import { telemetry } from '../lib/telemetry.js';

export async function runJobWithMetrics<T>(
  name: string,
  job: () => Promise<T>,
  details?: string,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await job();
    telemetry.jobs.recordOutcome({
      name,
      status: 'success',
      startedAt,
      durationMs: Date.now() - startedAt,
      details: details ?? (typeof result === 'string' ? result : undefined),
    });
    return result;
  } catch (error) {
    telemetry.jobs.recordOutcome({
      name,
      status: 'error',
      startedAt,
      durationMs: Date.now() - startedAt,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      details,
    });
    throw error;
  }
}

export interface UserJobTarget {
  userId: number;
  timezone: string;
}

export interface UserJobMeta {
  nextRun?: Date | undefined;
}

export interface UserJobStore {
  listTargets(): Promise<UserJobTarget[]>;
  getMeta(userId: number): Promise<UserJobMeta | undefined>;
  markStarted(userId: number): Promise<{ runId: number }>;
  markFinished(
    userId: number,
    runId: number,
    outcome: { status: 'success'; nextRun: Date } | { status: 'failed'; error: string; nextRun: Date },
  ): Promise<void>;
}

export interface PerUserJobOptions {
  name: string;
  store: UserJobStore;
  run: (target: UserJobTarget, now: DateTime) => Promise<void>;
  /** Computes the next run in the user's own timezone. */
  nextRun: (target: UserJobTarget, localNow: DateTime) => DateTime;
  retryAfterMinutes?: number;
}

export interface PerUserJobSummary {
  ran: number;
  skipped: number;
  failed: number;
}

/**
 * Runs a job for every user whose nextRun has passed. A failed run is retried
 * after `retryAfterMinutes`. One user's failure never stops the others.
 */
export async function runPerUserJob(
  options: PerUserJobOptions,
  now: Date = new Date(),
): Promise<PerUserJobSummary> {
  const summary: PerUserJobSummary = { ran: 0, skipped: 0, failed: 0 };
  const retryAfterMinutes = options.retryAfterMinutes ?? 15;
  const targets = await options.store.listTargets();

  for (const target of targets) {
    try {
      const meta = await options.store.getMeta(target.userId);
      if (meta?.nextRun && meta.nextRun > now) {
        summary.skipped += 1;
        continue;
      }

      const localNow = DateTime.fromJSDate(now, { zone: target.timezone });
      const { runId } = await options.store.markStarted(target.userId);

      try {
        await options.run(target, localNow);
        await options.store.markFinished(target.userId, runId, {
          status: 'success',
          nextRun: options.nextRun(target, localNow).toUTC().toJSDate(),
        });
        summary.ran += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Job ${options.name} failed for user ${target.userId}:`, error);
        await options.store.markFinished(target.userId, runId, {
          status: 'failed',
          error: message,
          nextRun: DateTime.fromJSDate(now).plus({ minutes: retryAfterMinutes }).toJSDate(),
        });
        summary.failed += 1;
      }
    } catch (error) {
      console.error(`Job ${options.name} could not run for user ${target.userId}:`, error);
      summary.failed += 1;
    }
  }

  return summary;
}

let tickTask: ScheduledTask | null = null;

/** Starts the one-minute tick. Only ever run this in the single worker process. */
export function startScheduler(onTick: () => Promise<void>): void {
  if (tickTask) {
    console.warn('Scheduler is already running');
    return;
  }

  tickTask = cron.schedule(
    '* * * * *',
    async () => {
      try {
        await runJobWithMetrics('tick', onTick);
      } catch (error) {
        console.error('Scheduler tick failed:', error);
      }
    },
    { timezone: 'UTC', noOverlap: true },
  );
}

export async function stopScheduler(): Promise<void> {
  if (tickTask) {
    await tickTask.stop();
    tickTask = null;
  }
}
