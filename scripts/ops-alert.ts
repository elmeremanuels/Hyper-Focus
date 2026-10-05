// Sends one alert to Elmer by Telegram and mail (verbeterplan P0.2). Used by the backup scripts.
// Usage: npm run ops:alert -- <key> "<text>"
import { getEnv } from '../src/config/env.js';
import { buildAlerter } from '../src/wiring.js';

const [key, ...words] = process.argv.slice(2);
if (!key || words.length === 0) {
  console.error('Usage: npm run ops:alert -- <key> "<text>"');
  process.exit(1);
}
await buildAlerter(getEnv())(key, words.join(' '));
