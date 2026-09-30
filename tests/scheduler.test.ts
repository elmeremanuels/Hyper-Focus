import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
  runJobWithMetrics,
  runPerUserJob,
  type UserJobStore,
  type UserJobTarget,
} from '../src/proactive/scheduler.js';
import { telemetry } from '../src/lib/telemetry.js';

function memoryStore(targets: UserJobTarget[], nextRuns: Record<number, Date> = {}) {
  const finished: Array<{ userId: number; status: string; nextRun: Date }> = [];
  const store: UserJobStore = {
    listTargets: async () => targets,
    getMeta: async (userId) => ({ nextRun: nextRuns[userId] }),
    markStarted: async () => ({ runId: 1 }),
    markFinished: async (userId, _runId, outcome) => {
      finished.push({ userId, status: outcome.status, nextRun: outcome.nextRun });
    },
  };
  return { store, finished };
}

// Next run at 00:05 local time tomorrow, like the daily planner (BOUWPLAN.md, 11.1).
const nextPlannerRun = (_target: UserJobTarget, localNow: DateTime) =>
  localNow.plus({ days: 1 }).set({ hour: 0, minute: 5, second: 0, millisecond: 0 });

describe('runPerUserJob', () => {
  const now = new Date('2026-10-06T12:00:00Z');

  it('computes the next run in each user timezone', async () => {
    const { store, finished } = memoryStore([
      { userId: 1, timezone: 'Asia/Makassar' },
      { userId: 2, timezone: 'Europe/Amsterdam' },
    ]);

    const summary = await runPerUserJob(
      { name: 'planner', store, run: async () => undefined, nextRun: nextPlannerRun },
      now,
    );

    expect(summary).toEqual({ ran: 2, skipped: 0, failed: 0 });
    // 00:05 on 7 Oct in Makassar (UTC+8) and Amsterdam (UTC+2, summer time).
    expect(finished[0]!.nextRun.toISOString()).toBe('2026-10-06T16:05:00.000Z');
    expect(finished[1]!.nextRun.toISOString()).toBe('2026-10-06T22:05:00.000Z');
  });

  it('handles the switch from summer to winter time in Amsterdam', async () => {
    const { store, finished } = memoryStore([{ userId: 1, timezone: 'Europe/Amsterdam' }]);
    // Saturday 24 Oct 2026; summer time ends on Sunday 25 Oct.
    await runPerUserJob(
      { name: 'planner', store, run: async () => undefined, nextRun: nextPlannerRun },
      new Date('2026-10-24T12:00:00Z'),
    );
    // 00:05 on 25 Oct is still summer time (UTC+2); the switch happens at 03:00.
    expect(finished[0]!.nextRun.toISOString()).toBe('2026-10-24T22:05:00.000Z');

    const later = memoryStore([{ userId: 1, timezone: 'Europe/Amsterdam' }]);
    await runPerUserJob(
      { name: 'planner', store: later.store, run: async () => undefined, nextRun: nextPlannerRun },
      new Date('2026-10-25T12:00:00Z'),
    );
    // 00:05 on 26 Oct is winter time (UTC+1).
    expect(later.finished[0]!.nextRun.toISOString()).toBe('2026-10-25T23:05:00.000Z');
  });

  it('skips users whose next run is in the future', async () => {
    const { store } = memoryStore([{ userId: 1, timezone: 'Europe/Amsterdam' }], {
      1: new Date('2026-10-06T13:00:00Z'),
    });
    let calls = 0;
    const summary = await runPerUserJob(
      {
        name: 'planner',
        store,
        run: async () => {
          calls += 1;
        },
        nextRun: nextPlannerRun,
      },
      now,
    );
    expect(summary.skipped).toBe(1);
    expect(calls).toBe(0);
  });

  it('schedules a retry after a failure and keeps going with other users', async () => {
    const { store, finished } = memoryStore([
      { userId: 1, timezone: 'Europe/Amsterdam' },
      { userId: 2, timezone: 'Asia/Makassar' },
    ]);
    const summary = await runPerUserJob(
      {
        name: 'planner',
        store,
        run: async (target) => {
          if (target.userId === 1) throw new Error('boom');
        },
        nextRun: nextPlannerRun,
        retryAfterMinutes: 10,
      },
      now,
    );
    expect(summary).toEqual({ ran: 1, skipped: 0, failed: 1 });
    expect(finished[0]).toMatchObject({ userId: 1, status: 'failed' });
    expect(finished[0]!.nextRun.toISOString()).toBe('2026-10-06T12:10:00.000Z');
    expect(finished[1]).toMatchObject({ userId: 2, status: 'success' });
  });
});

describe('runJobWithMetrics', () => {
  it('records success and error outcomes', async () => {
    await runJobWithMetrics('ok-job', async () => 'done');
    await expect(
      runJobWithMetrics('bad-job', async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');

    const runs = telemetry.jobs.getSnapshot().recentRuns;
    expect(runs[0]).toMatchObject({ name: 'bad-job', status: 'error', errorMessage: 'fail' });
    expect(runs[1]).toMatchObject({ name: 'ok-job', status: 'success', details: 'done' });
  });
});
