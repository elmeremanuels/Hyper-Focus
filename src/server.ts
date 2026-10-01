import { createApp, type AppOptions } from './app.js';
import { createMailProcessor } from './channels/email/processor.js';
import { createTelegramProcessor } from './channels/telegram/processor.js';
import { getEnv } from './config/env.js';
import { connect } from './db/client.js';
import { buildServices } from './wiring.js';

const env = getEnv();
const options: AppOptions = {
  telegram: { secretToken: env.TELEGRAM_WEBHOOK_SECRET },
  mail: { secret: env.EMAIL_INBOUND_SECRET },
};

if (env.DATABASE_URL) {
  const { db } = connect(env.DATABASE_URL);
  const services = buildServices(env, db);

  if (services.telegramClient) {
    options.telegram = {
      secretToken: env.TELEGRAM_WEBHOOK_SECRET,
      onUpdate: createTelegramProcessor({
        client: services.telegramClient,
        users: services.users,
        messages: services.messages,
        delivery: services.delivery,
        router: services.router,
        allowedUserIds: env.TELEGRAM_ALLOWED_USER_IDS,
        linkSecret: env.ACTION_LINK_SECRET,
      }),
    };
  } else {
    console.warn('TELEGRAM_BOT_TOKEN not set: Telegram updates are verified but not processed');
  }

  options.mail = {
    secret: env.EMAIL_INBOUND_SECRET,
    onMail: createMailProcessor({
      users: services.users,
      messages: services.messages,
      delivery: services.delivery,
      router: services.router,
      allowedSenders: env.EMAIL_ALLOWED_SENDERS,
    }),
  };

  options.actions = {
    secret: env.ACTION_LINK_SECRET,
    baseUrl: env.APP_BASE_URL,
    users: services.users,
    messages: services.messages,
    router: services.router,
  };
} else {
  console.warn('DATABASE_URL not set: webhooks are verified but not processed');
}

createApp(options).listen(env.PORT, () => {
  console.log(`hyperfocus-web listening on port ${env.PORT} (${env.NODE_ENV})`);
});
