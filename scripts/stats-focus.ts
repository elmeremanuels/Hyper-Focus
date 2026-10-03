// Measurements for the test weeks of step 1.9. Usage: npm run stats:focus -- --days 14
import { parseArgs } from 'node:util';
import { getEnv } from '../src/config/env.js';
import { connect } from '../src/db/client.js';
import { focusStats, formatFocusStats } from '../src/stats/focus.js';

const { values } = parseArgs({ options: { days: { type: 'string', default: '14' } } });
const days = Number(values.days);
if (!Number.isInteger(days) || days < 1) {
  console.error('Use --days N');
  process.exit(1);
}

const connection = connect(getEnv().DATABASE_URL);
try {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  console.log(formatFocusStats(await focusStats(connection.db, since), days));
} finally {
  await connection.close();
}
