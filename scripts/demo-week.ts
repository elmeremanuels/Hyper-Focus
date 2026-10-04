// The demo week (step 2a.8): npm run demo:week [-- --reset]
// Creates a demo account with five work days of history and prints a one-time login link.
// Uses scripts/demo-week.local.ts (default export: DemoWeek) when it exists, else the
// fictional src/db/seed/demo.ts. The account is paused: nothing goes out by Telegram or mail.
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { getEnv } from '../src/config/env.js';
import { connect } from '../src/db/client.js';
import fictional from '../src/db/seed/demo.js';
import { removeDemo, seedDemoWeek, type DemoWeek } from '../src/demo/week.js';
import { loginUrl } from '../src/web/auth/routes.js';
import { createLoginToken } from '../src/web/auth/sessions.js';

const { values } = parseArgs({ options: { reset: { type: 'boolean' } } });
const env = getEnv();
const local = new URL('./demo-week.local.ts', import.meta.url);
const week: DemoWeek = existsSync(local) ? ((await import(local.href)) as { default: DemoWeek }).default : fictional;

const connection = connect(env.DATABASE_URL);
try {
  const now = new Date();
  if (values.reset && (await removeDemo(connection.db, week.seed.user.email))) console.log('Old demo account removed.');
  const { userId } = await seedDemoWeek(connection.db, week, now);
  console.log(`Demo account ${userId} ready (${existsSync(local) ? 'demo-week.local.ts' : 'fictional content'}).`);
  const token = await createLoginToken(connection.db, userId, 'email', now);
  const base = env.DASHBOARD_BASE_URL ?? `http://localhost:${env.PORT}`;
  if (token) console.log(`Log in within 15 minutes, once: ${loginUrl(base, token)}`);
} finally {
  await connection.close();
}
