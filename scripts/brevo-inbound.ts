// Registers the Brevo inbound webhook: mail to {domain} is posted to
// {APP_BASE_URL}/webhooks/mail/{EMAIL_INBOUND_SECRET}. Run once on the VPS.
// Usage: npm run brevo:inbound -- --domain in.hyper-focus.pro
import { parseArgs } from 'node:util';
import { getEnv } from '../src/config/env.js';

const { values } = parseArgs({ options: { domain: { type: 'string' } } });
const env = getEnv();

if (!env.BREVO_API_KEY || !env.EMAIL_INBOUND_SECRET || !env.APP_BASE_URL || !values.domain) {
  console.error('Set BREVO_API_KEY, EMAIL_INBOUND_SECRET and APP_BASE_URL in .env and pass --domain.');
  process.exit(1);
}

const url = `${env.APP_BASE_URL.replace(/\/$/, '')}/webhooks/mail/${env.EMAIL_INBOUND_SECRET}`;
const response = await fetch('https://api.brevo.com/v3/webhooks', {
  method: 'POST',
  headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify({
    type: 'inbound',
    events: ['inboundEmailProcessed'],
    url,
    domain: values.domain,
    description: 'Hyper&Focus inbound mail',
  }),
});

const body = await response.text();
if (!response.ok) {
  console.error(`Brevo refused the webhook (${response.status}): ${body}`);
  process.exit(1);
}
console.log(`Brevo inbound webhook created for ${values.domain} (${body})`);
