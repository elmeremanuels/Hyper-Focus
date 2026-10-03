// Plays the planning of one or more days at speed, including the guardrails (BOUWPLAN.md, 15).
// Usage: npm run sim:day -- --date 2026-10-06 [--days 7] [--silent] [--email sam@voorbeeld.invalid]
// Everything runs in a transaction that is rolled back: nothing is stored or sent.
import { parseArgs } from 'node:util';
import { DateTime } from 'luxon';
import { getEnv } from '../src/config/env.js';
import { createDbUserStore } from '../src/core/users.js';
import { connect } from '../src/db/client.js';
import example from '../src/db/seed/example.js';
import { simulateDays } from '../src/proactive/simulate.js';

const { values } = parseArgs({
  options: {
    date: { type: 'string' },
    days: { type: 'string', default: '1' },
    silent: { type: 'boolean', default: false },
    email: { type: 'string', default: example.user.email },
  },
});
if (!values.date || !/^\d{4}-\d{2}-\d{2}$/.test(values.date)) {
  console.error('Use --date YYYY-MM-DD');
  process.exit(1);
}

const env = getEnv();
const connection = connect(env.DATABASE_URL);
try {
  const user = await createDbUserStore(connection.db).findByEmail(values.email);
  if (!user) throw new Error(`No user with mail address ${values.email}. Run npm run db:seed first.`);
  const [profile] = await connection.pool
    .query<{ timezone: string }>('select timezone from users where id = $1', [user.id])
    .then((r) => r.rows);
  const zone = profile?.timezone ?? 'Europe/Amsterdam';

  const result = await simulateDays({
    db: connection.db,
    userId: user.id,
    start: values.date,
    days: Number(values.days),
    silent: values.silent,
  });

  const fmt = (at: Date) => DateTime.fromJSDate(at, { zone }).setLocale('nl').toFormat('ccc d LLL HH:mm');
  console.log(`Dagsimulatie · ${values.email} · ${zone} · ${values.days} dag(en)${values.silent ? ' · stil' : ''}\n`);
  for (const message of result.sent) {
    const buttons = message.buttons.length ? `\n    [${message.buttons.join('] [')}]` : '';
    console.log(`${fmt(message.at)} · ${message.channel}\n    ${message.text.replace(/\n/g, '\n    ')}${buttons}\n`);
  }
  if (result.skipped.length) {
    console.log('Overgeslagen:');
    for (const skip of result.skipped) console.log(`  ${fmt(skip.at)} · ${skip.kind} · ${skip.reason}`);
  }
} finally {
  await connection.close();
}
