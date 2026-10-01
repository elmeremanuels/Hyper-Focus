// Builds the channel layer from env and a database connection. Shared by the web
// process and the scripts.
import { createDelivery, type Channel, type ChannelName } from './channels/channel.js';
import { EmailChannel } from './channels/email/channel.js';
import { EmailSender } from './channels/email/send.js';
import { TelegramChannel } from './channels/telegram/channel.js';
import { TelegramClient } from './channels/telegram/client.js';
import type { Env } from './config/env.js';
import { createDbRouterDeps } from './conversation/deps.js';
import { createRouter } from './conversation/router.js';
import { createDbMessageStore } from './core/messages.js';
import { createDbUserStore } from './core/users.js';
import type { Database } from './db/client.js';

export function buildServices(env: Env, db: Database) {
  const users = createDbUserStore(db);
  const messages = createDbMessageStore(db);
  const router = createRouter(createDbRouterDeps(db));

  const telegramClient = env.TELEGRAM_BOT_TOKEN ? new TelegramClient(env.TELEGRAM_BOT_TOKEN) : undefined;
  const sender = new EmailSender({
    apiKey: env.SENDGRID_API_KEY,
    from: env.EMAIL_FROM,
    replyTo: env.EMAIL_REPLY_TO,
  });

  const channels: Partial<Record<ChannelName, Channel>> = {
    email: new EmailChannel(sender, messages, {
      actionLinkSecret: env.ACTION_LINK_SECRET,
      baseUrl: env.APP_BASE_URL,
    }),
    ...(telegramClient && { telegram: new TelegramChannel(telegramClient, messages) }),
  };

  return { users, messages, router, telegramClient, delivery: createDelivery(channels) };
}
