import { createApp } from './app.js';
import { WhatsAppChannel } from './channels/whatsapp/channel.js';
import { WhatsAppClient } from './channels/whatsapp/client.js';
import { createWebhookProcessor } from './channels/whatsapp/processor.js';
import { getEnv } from './config/env.js';
import { createDbRouterDeps } from './conversation/deps.js';
import { createRouter } from './conversation/router.js';
import { createDbMessageStore } from './core/messages.js';
import { connect } from './db/client.js';

const env = getEnv();

function buildWebhookHandler(): ((body: unknown) => Promise<unknown>) | undefined {
  const { DATABASE_URL, WHATSAPP_GRAPH_VERSION, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID } = env;
  if (!DATABASE_URL || !WHATSAPP_GRAPH_VERSION || !WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.warn('WhatsApp or database not configured: webhook messages are verified but not processed');
    return undefined;
  }

  const { db } = connect(DATABASE_URL);
  const store = createDbMessageStore(db);
  const client = new WhatsAppClient({
    graphVersion: WHATSAPP_GRAPH_VERSION,
    accessToken: WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
  });

  return createWebhookProcessor({
    store,
    router: createRouter(createDbRouterDeps(db)),
    allowedNumbers: env.WHATSAPP_ALLOWED_NUMBERS,
    channelFor: (userId) => new WhatsAppChannel(client, store, userId),
  });
}

const onPayload = buildWebhookHandler();
const app = createApp({
  whatsapp: {
    verifyToken: env.WHATSAPP_VERIFY_TOKEN,
    appSecret: env.WHATSAPP_APP_SECRET,
    ...(onPayload && { onPayload }),
  },
});

app.listen(env.PORT, () => {
  console.log(`hyperfocus-web listening on port ${env.PORT} (${env.NODE_ENV})`);
});
