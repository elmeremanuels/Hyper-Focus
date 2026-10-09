import { createApp, type AppOptions } from './app.js';
import { Transcriber } from './ai/transcribe.js';
import { createMailProcessor } from './channels/email/processor.js';
import { createTelegramProcessor } from './channels/telegram/processor.js';
import { getEnv } from './config/env.js';
import { connect } from './db/client.js';
import { buildServices } from './wiring.js';
import { watchErrors } from './ops/error-watch.js';
import { resolve } from 'node:path';
import { LOGIN_TEXTS } from './texts/dashboard.nl.js';
import { requestDoubleOptin } from './integrations/brevo/double-optin.js';
import { WAITLIST_PAGES } from './web/waitlist.js';

const env = getEnv();
const options: AppOptions = {
  telegram: { secretToken: env.TELEGRAM_WEBHOOK_SECRET },
  mail: { secret: env.EMAIL_INBOUND_SECRET },
  heartbeatFile: env.WORKER_HEARTBEAT_FILE,
};

if (env.DATABASE_URL) {
  const { db } = connect(env.DATABASE_URL);
  const services = buildServices(env, db);
  watchErrors(services.alert, 'hyperfocus-web');
  options.mediaDir = services.content.media?.dir;

  if (services.telegramClient) {
    options.telegram = {
      secretToken: env.TELEGRAM_WEBHOOK_SECRET,
      onUpdate: createTelegramProcessor({
        client: services.telegramClient,
        users: services.users,
        messages: services.messages,
        delivery: services.delivery,
        router: services.router,
        isQuiet: services.isQuiet,
        allowedUserIds: env.TELEGRAM_ALLOWED_USER_IDS,
        linkSecret: env.ACTION_LINK_SECRET,
        transcriber: new Transcriber({ apiKey: env.OPENAI_API_KEY, model: env.TRANSCRIBE_MODEL }),
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
      maxSpamScore: env.EMAIL_MAX_SPAM_SCORE,
    }),
  };

  options.actions = {
    secret: env.ACTION_LINK_SECRET,
    baseUrl: env.APP_BASE_URL,
    users: services.users,
    messages: services.messages,
    router: services.router,
  };

  options.reward = { db, botToken: env.TELEGRAM_BOT_TOKEN };
  if (env.APP_BASE_URL) {
    const site = new URL(env.APP_BASE_URL);
    options.site = { dir: resolve('dist/site'), host: site.hostname };
    const { BREVO_API_KEY: apiKey, BREVO_WAITLIST_LIST_ID: listId, BREVO_DOI_TEMPLATE_ID: templateId } = env;
    const doi = apiKey && listId && templateId ? { apiKey, listId, templateId, redirectionUrl: new URL(WAITLIST_PAGES.confirmed, site).toString() } : undefined;
    options.waitlist = { host: site.hostname, signup: doi && ((email) => requestDoubleOptin(doi, email)) };
  }
  if (env.DASHBOARD_BASE_URL) {
    const dashboardBaseUrl = env.DASHBOARD_BASE_URL;
    options.dashboardApi = { db, botToken: env.TELEGRAM_BOT_TOKEN };
    options.dashboard = { db, dashboardBaseUrl, calendar: services.calendar, claude: services.claude, content: services.content };
    options.dashboardWeb = { dir: resolve('dist/dashboard'), host: new URL(dashboardBaseUrl).hostname };
    options.auth = {
      db,
      dashboardBaseUrl,
      findUserByEmail: async (email) => {
        const user = await services.users.findByEmail(email);
        return user ? { id: user.id } : undefined;
      },
      // The login link always goes by mail, also when Telegram is the usual channel.
      sendLoginMail: async (userId, url) => {
        const user = await services.users.findById(userId);
        if (!user) return;
        await services.delivery.send(
          user,
          { text: LOGIN_TEXTS.mailText, buttons: [{ id: 'login', title: LOGIN_TEXTS.mailButton, url }] },
          { via: 'email', context: { subject: LOGIN_TEXTS.mailSubject } },
        );
      },
    };
  }

  if (services.calendar) {
    options.calendar = {
      db,
      service: services.calendar,
      notify: async (userId, text) => {
        const user = await services.users.findById(userId);
        if (user) await services.delivery.send(user, { text });
      },
    };
  } else {
    console.warn('Calendar off: set ENCRYPTION_KEY, ACTION_LINK_SECRET and APP_BASE_URL to enable it');
  }
} else {
  console.warn('DATABASE_URL not set: webhooks are verified but not processed');
}

createApp(options).listen(env.PORT, () => {
  console.log(`hyperfocus-web listening on port ${env.PORT} (${env.NODE_ENV})`);
});
