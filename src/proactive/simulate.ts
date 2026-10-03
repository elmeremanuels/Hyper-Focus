// Plays the proactive layer through one or more days at speed (BOUWPLAN.md, 15: sim:day).
// Runs inside a transaction that is always rolled back, so nothing is stored or sent.
import { and, asc, eq, gte, lt } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { createDelivery, type Channel, type ChannelName, type ChannelUser, type SendContext } from '../channels/channel.js';
import { createAssistantRouter } from '../conversation/assistant.js';
import { isFocusQuiet } from '../conversation/blocks.js';
import type { InboundMessage, OutboundMessage } from '../conversation/types.js';
import { createDbUserStore } from '../core/users.js';
import type { Database } from '../db/client.js';
import { scheduledNudges, users } from '../db/schema/index.js';
import { runPlanner } from './planner.js';
import { sendDueNudges } from './sender.js';

export interface SimulatedMessage {
  at: Date;
  channel: ChannelName;
  text: string;
  buttons: string[];
  /** Sent without sound (during a work block or pause). */
  silent?: boolean;
  /** What the user did; the message after it is the reply. */
  user?: boolean;
}

/** A scripted tap or message at a local time, on day 0, 1, …; return undefined to do nothing. */
export interface SimulatedAction {
  day: number;
  time: string;
  message: (ctx: { db: Database; userId: number; now: Date }) => Promise<InboundMessage | undefined>;
}

export interface SimulatedSkip {
  at: Date;
  kind: string;
  reason: string;
}

export interface SimulationResult {
  sent: SimulatedMessage[];
  skipped: SimulatedSkip[];
}

export interface SimulationOptions {
  db: Database;
  userId: number;
  /** First local date, YYYY-MM-DD. */
  start: string;
  days: number;
  /** The user never writes. Otherwise they write every day at 09:00. */
  silent: boolean;
  stepMinutes?: number;
  /** Taps and messages of the user, answered without Claude. */
  actions?: SimulatedAction[];
}

class RecordingChannel implements Channel {
  constructor(
    readonly name: ChannelName,
    private readonly userId: number,
    private readonly clock: () => Date,
    private readonly out: SimulatedMessage[],
  ) {}

  async send(user: ChannelUser, message: OutboundMessage, context?: SendContext): Promise<void> {
    if (user.id !== this.userId) return;
    this.out.push({
      at: this.clock(),
      channel: this.name,
      text: message.text,
      buttons: (message.choices ?? message.buttons ?? []).map((button) => button.title),
      ...(context?.silent && { silent: true }),
    });
  }
}

class Rollback extends Error {}

export async function simulateDays(options: SimulationOptions): Promise<SimulationResult> {
  const result: SimulationResult = { sent: [], skipped: [] };
  const step = options.stepMinutes ?? 5;

  try {
    await options.db.transaction(async (tx) => {
      const db = tx as unknown as Database;
      const [user] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, options.userId));
      if (!user) throw new Error(`Unknown user ${options.userId}`);

      const first = DateTime.fromISO(options.start, { zone: user.timezone }).startOf('day');
      const end = first.plus({ days: options.days });
      let now = first.toJSDate();
      const clock = () => now;

      // The user last wrote the evening before the first day.
      await db.update(users).set({ lastInboundAt: first.minus({ hours: 3 }).toJSDate() }).where(eq(users.id, options.userId));

      const delivery = createDelivery(
        {
          telegram: new RecordingChannel('telegram', options.userId, clock, result.sent),
          email: new RecordingChannel('email', options.userId, clock, result.sent),
        },
        { warn: () => undefined },
      );
      const deps = { db, delivery, users: createDbUserStore(db), log: { error: console.error, warn: () => undefined } };
      const router = createAssistantRouter({ db, claude: undefined, now: clock, appBaseUrl: 'https://hyper-focus.invalid' });

      for (let t = first; t < end; t = t.plus({ minutes: step })) {
        now = t.toJSDate();
        if (!options.silent && t.hour === 9 && t.minute === 0) {
          await db.update(users).set({ lastInboundAt: now }).where(eq(users.id, options.userId));
        }
        const day = Math.round(t.startOf('day').diff(first, 'days').days);
        for (const action of options.actions ?? []) {
          if (action.day !== day || action.time !== t.toFormat('HH:mm')) continue;
          const message = await action.message({ db, userId: options.userId, now });
          if (!message) continue;
          const silent = await isFocusQuiet(db, options.userId, now);
          result.sent.push({ at: now, channel: 'telegram', text: message.kind === 'text' ? message.text : message.title, buttons: [], user: true });
          for (const reply of await router(message)) {
            result.sent.push({
              at: now,
              channel: 'telegram',
              text: reply.text,
              buttons: (reply.choices ?? reply.buttons ?? []).map((button) => button.title),
              ...(silent && { silent: true }),
            });
          }
        }
        await runPlanner(db, now);
        await sendDueNudges(deps, now);
      }

      const skipped = await db
        .select()
        .from(scheduledNudges)
        .where(
          and(
            eq(scheduledNudges.userId, options.userId),
            eq(scheduledNudges.status, 'skipped'),
            gte(scheduledNudges.scheduledForUtc, first.toJSDate()),
            lt(scheduledNudges.scheduledForUtc, end.toJSDate()),
          ),
        )
        .orderBy(asc(scheduledNudges.scheduledForUtc));
      result.skipped = skipped.map((nudge) => ({ at: nudge.scheduledForUtc, kind: nudge.kind, reason: nudge.skipReason ?? '' }));
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  return result;
}
