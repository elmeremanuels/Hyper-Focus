// Prints the one-time Telegram deeplink for a user (BOUWPLAN.md, 9.2).
// Usage: npm run link:telegram [-- --email you@example.nl]
// Without --email it uses the first user in the database. The link is valid 30 minutes.
import { parseArgs } from 'node:util';
import { asc } from 'drizzle-orm';
import { createLinkCode, deeplink } from '../src/channels/telegram/link.js';
import { getEnv } from '../src/config/env.js';
import { createDbUserStore } from '../src/core/users.js';
import { connect } from '../src/db/client.js';
import { users } from '../src/db/schema/index.js';

const { values } = parseArgs({ options: { email: { type: 'string' } } });
const env = getEnv();

if (!env.ACTION_LINK_SECRET || !env.TELEGRAM_BOT_USERNAME) {
  console.error('Set ACTION_LINK_SECRET and TELEGRAM_BOT_USERNAME in .env first.');
  process.exit(1);
}

const connection = connect(env.DATABASE_URL);
try {
  const user = values.email
    ? await createDbUserStore(connection.db).findByEmail(values.email)
    : (await connection.db.select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.id)).limit(1))[0];

  if (!user) {
    console.error('No user found. Run npm run db:seed first.');
    process.exitCode = 1;
  } else {
    const code = createLinkCode(user.id, env.ACTION_LINK_SECRET);
    console.log(`Koppellink voor ${user.name} (30 minuten geldig):\n${deeplink(env.TELEGRAM_BOT_USERNAME, code)}`);
  }
} finally {
  await connection.close();
}
