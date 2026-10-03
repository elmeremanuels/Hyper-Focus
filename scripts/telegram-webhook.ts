// Registers the webhook with Telegram: {APP_BASE_URL}/webhooks/telegram with the secret token.
// Also sets the command menu. Run on the VPS after setting TELEGRAM_* in .env, and again
// when the menu changes. Usage: npm run telegram:webhook
import { TelegramClient } from '../src/channels/telegram/client.js';
import { BOT_COMMANDS } from '../src/channels/telegram/processor.js';
import { getEnv } from '../src/config/env.js';

const env = getEnv();
if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET || !env.APP_BASE_URL) {
  console.error('Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and APP_BASE_URL in .env first.');
  process.exit(1);
}

const url = `${env.APP_BASE_URL.replace(/\/$/, '')}/webhooks/telegram`;
const client = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
await client.setWebhook(url, env.TELEGRAM_WEBHOOK_SECRET);
console.log(`Telegram webhook set to ${url}`);
await client.setMyCommands(BOT_COMMANDS);
console.log(`Command menu set: ${BOT_COMMANDS.map((c) => `/${c.command}`).join(' ')}`);
