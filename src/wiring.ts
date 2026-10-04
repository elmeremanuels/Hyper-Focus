// Builds the channel layer from env and a database connection. Shared by the web
// process and the scripts.
import { createDelivery, type Channel, type ChannelName } from './channels/channel.js';
import { EmailChannel } from './channels/email/channel.js';
import { EmailSender } from './channels/email/send.js';
import { TelegramChannel } from './channels/telegram/channel.js';
import { TelegramClient } from './channels/telegram/client.js';
import type { Env } from './config/env.js';
import { ClaudeClient } from './ai/claude.js';
import { createAlerter } from './ops/alerts.js';
import { createAssistantRouter } from './conversation/assistant.js';
import { isFocusQuiet } from './conversation/blocks.js';
import { recordAiUsage } from './core/events.js';
import { buildCalendarService } from './integrations/calendar/service.js';
import { createDbMessageStore } from './core/messages.js';
import { createDbUserStore } from './core/users.js';
import type { Database } from './db/client.js';

export function buildServices(env: Env, db: Database) {
  const users = createDbUserStore(db);
  const messages = createDbMessageStore(db);
  const claude = buildClaude(env, db);
  const calendar = buildCalendarService(env);
  const telegramClient = env.TELEGRAM_BOT_TOKEN ? new TelegramClient(env.TELEGRAM_BOT_TOKEN) : undefined;
  const sender = new EmailSender({
    apiKey: env.BREVO_API_KEY,
    from: env.EMAIL_FROM,
    replyTo: env.EMAIL_REPLY_TO,
  });
  const alert = buildAlerter(env, telegramClient, sender);
  const router = createAssistantRouter({ db, claude, calendar, appBaseUrl: env.APP_BASE_URL, dashboardBaseUrl: env.DASHBOARD_BASE_URL, alert });
  const isQuiet = (userId: number) => isFocusQuiet(db, userId, new Date());

  const channels: Partial<Record<ChannelName, Channel>> = {
    email: new EmailChannel(sender, messages, {
      actionLinkSecret: env.ACTION_LINK_SECRET,
      baseUrl: env.APP_BASE_URL,
    }),
    ...(telegramClient && { telegram: new TelegramChannel(telegramClient, messages) }),
  };

  return { users, messages, router, isQuiet, claude, calendar, telegramClient, alert, delivery: createDelivery(channels) };
}

/** Alerts to Elmer (verbeterplan P0.2): his own Telegram chat and/or a mail address. No database needed. */
export function buildAlerter(
  env: Env,
  telegramClient = env.TELEGRAM_BOT_TOKEN ? new TelegramClient(env.TELEGRAM_BOT_TOKEN) : undefined,
  sender = new EmailSender({ apiKey: env.BREVO_API_KEY, from: env.EMAIL_FROM, replyTo: env.EMAIL_REPLY_TO }),
) {
  const alertChat = env.ALERT_TELEGRAM_CHAT_ID;
  const alertEmail = env.ALERT_EMAIL;
  return createAlerter({
    telegram: telegramClient && alertChat ? async (text) => void (await telegramClient.sendMessage(alertChat, text)) : undefined,
    email:
      alertEmail && sender.isConfigured()
        ? async (subject, text) => void (await sender.send({ to: alertEmail, subject, text, html: `<p>${text.replace(/[<>&]/g, '')}</p>` }))
        : undefined,
  });
}

/** Claude with usage logged to ai_usage, or undefined without a key and fast model. */
export function buildClaude(env: Env, db: Database): ClaudeClient | undefined {
  if (!env.ANTHROPIC_API_KEY || !env.CLAUDE_MODEL_FAST) return undefined;
  return new ClaudeClient(
    {
      apiKey: env.ANTHROPIC_API_KEY,
      modelFast: env.CLAUDE_MODEL_FAST,
      modelSmart: env.CLAUDE_MODEL_SMART,
      effortFast: env.CLAUDE_EFFORT_FAST,
      effortSmart: env.CLAUDE_EFFORT_SMART,
    },
    async ({ userId, ...usage }) => {
      if (userId === undefined) return;
      try {
        await recordAiUsage(db, { userId, ...usage });
      } catch (error) {
        console.error('Recording AI usage failed:', error);
      }
    },
  );
}
