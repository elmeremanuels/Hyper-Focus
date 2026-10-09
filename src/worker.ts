// hyperfocus-worker (BOUWPLAN.md, 11.1): a one-minute tick that plans each user's day and
// sends due messages. Run exactly one worker process.
import { eq } from 'drizzle-orm';
import { getEnv } from './config/env.js';
import { users } from './db/schema/index.js';
import { staleConnections, syncUserCalendars } from './integrations/calendar/sync.js';
import { connect } from './db/client.js';
import { runMaintenance } from './proactive/maintenance.js';
import { checkAnthropic, checkOpenAI, checkTelegramWebhook } from './ops/checks.js';
import { watchErrors } from './ops/error-watch.js';
import { writeHeartbeat } from './ops/heartbeat.js';
import { runPlanner } from './proactive/planner.js';
import { startScheduler, stopScheduler } from './proactive/scheduler.js';
import { sendDueNudges } from './proactive/sender.js';
import { expireWaitingPosts } from './content/planner.js';
import { cleanupWeekMedia } from './content/media.js';
import { checkScheduledPosts } from './content/status.js';
import { buildServices } from './wiring.js';

const env = getEnv();
if (!env.DATABASE_URL) {
  console.error('DATABASE_URL is required for the worker');
  process.exit(1);
}

const connection = connect(env.DATABASE_URL);
const services = buildServices(env, connection.db);
watchErrors(services.alert, 'hyperfocus-worker');

const MAINTENANCE_MINUTE = 17;
const DAILY_CHECK_HOUR_UTC = 1;

export async function tick(now: Date = new Date()): Promise<void> {
  const planned = await runPlanner(connection.db, now, { calendar: services.calendar });
  if (services.calendar) await refreshCalendars(connection.db, services.calendar, now);
  if (env.WORKER_HEARTBEAT_FILE) await writeHeartbeat(env.WORKER_HEARTBEAT_FILE, now);
  const sent = await sendDueNudges(
    {
      db: connection.db,
      delivery: services.delivery,
      users: services.users,
      // Messages queued while the AI was out (verbeterplan P0.2).
      retry: (message) => services.router({ kind: 'text', ...message, queued: true }),
      // Content module (step C2): Claude writes the afternoon bundle.
      content: { claude: services.claude, deps: services.content },
    },
    now,
  );
  // A post still waiting at its moment is skipped: nothing goes live without approval (step C2).
  await expireWaitingPosts(connection.db, now);
  // Once an hour: open blocks and retention (verbeterplan P0.1).
  if (now.getUTCMinutes() === MAINTENANCE_MINUTE) {
    const done = await runMaintenance(connection.db, now);
    if (Object.values(done).some((n) => n > 0)) console.log('maintenance:', JSON.stringify(done));
    // Content module (step C3): did Buffer post it, and photos of past weeks.
    const posts = await checkScheduledPosts(connection.db, services.content, now, async (userId, text) => {
      const user = await services.users.findById(userId);
      if (user) await services.delivery.send(user, { text });
    });
    if (posts.sent + posts.failed > 0) console.log('posts:', JSON.stringify(posts));
    if (services.content.media) await cleanupWeekMedia(connection.db, services.content.media, now);
    if (services.telegramClient) {
      const problem = await checkTelegramWebhook(services.telegramClient, now);
      if (problem) await services.alert('telegram_webhook', problem);
    }
    // Once a day at 09:17 in Makassar (01:17 UTC): do the AI keys and credit still work?
    if (now.getUTCHours() === DAILY_CHECK_HOUR_UTC) {
      const anthropic = services.claude ? await checkAnthropic(services.claude) : undefined;
      if (anthropic) await services.alert('anthropic', anthropic);
      const openai = env.OPENAI_API_KEY ? await checkOpenAI(env.OPENAI_API_KEY) : undefined;
      if (openai) await services.alert('openai', openai);
    }
  }
  if (planned.length > 0 || sent.sent + sent.skipped + sent.failed > 0) {
    console.log(
      `tick: planned ${planned.length}, sent ${sent.sent}, skipped ${sent.skipped}, failed ${sent.failed}`,
    );
  }
}

/** Every 15 minutes per connection (BOUWPLAN.md, 11.8). */
async function refreshCalendars(db: typeof connection.db, calendar: NonNullable<typeof services.calendar>, now: Date) {
  for (const { userId } of await staleConnections(db, now)) {
    const [user] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId));
    await syncUserCalendars(db, calendar, userId, user?.timezone ?? env.DEFAULT_TIMEZONE, now);
  }
}

startScheduler(() => tick());
console.log('hyperfocus-worker started');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void stopScheduler().then(() => connection.close()).then(() => process.exit(0));
  });
}
