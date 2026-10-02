// hyperfocus-worker (BOUWPLAN.md, 11.1): a one-minute tick that plans each user's day and
// sends due messages. Run exactly one worker process.
import { getEnv } from './config/env.js';
import { connect } from './db/client.js';
import { runPlanner } from './proactive/planner.js';
import { startScheduler, stopScheduler } from './proactive/scheduler.js';
import { sendDueNudges } from './proactive/sender.js';
import { buildServices } from './wiring.js';

const env = getEnv();
if (!env.DATABASE_URL) {
  console.error('DATABASE_URL is required for the worker');
  process.exit(1);
}

const connection = connect(env.DATABASE_URL);
const services = buildServices(env, connection.db);

export async function tick(now: Date = new Date()): Promise<void> {
  const planned = await runPlanner(connection.db, now);
  const sent = await sendDueNudges({ db: connection.db, delivery: services.delivery, users: services.users }, now);
  if (planned.length > 0 || sent.sent + sent.skipped + sent.failed > 0) {
    console.log(
      `tick: planned ${planned.length}, sent ${sent.sent}, skipped ${sent.skipped}, failed ${sent.failed}`,
    );
  }
}

startScheduler(() => tick());
console.log('hyperfocus-worker started');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void stopScheduler().then(() => connection.close()).then(() => process.exit(0));
  });
}
