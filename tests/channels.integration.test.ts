import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createDelivery } from '../src/channels/channel.js';
import { EmailChannel } from '../src/channels/email/channel.js';
import { createMailProcessor, type MailOutcome } from '../src/channels/email/processor.js';
import { EmailSender } from '../src/channels/email/send.js';
import { TelegramChannel } from '../src/channels/telegram/channel.js';
import { TelegramClient } from '../src/channels/telegram/client.js';
import { createLinkCode } from '../src/channels/telegram/link.js';
import { createTelegramProcessor, type TelegramOutcome } from '../src/channels/telegram/processor.js';
import { createAssistantRouter, type AssistantDeps } from '../src/conversation/assistant.js';
import { createDbMessageStore } from '../src/core/messages.js';
import { createDbUserStore } from '../src/core/users.js';
import { connect, type DbConnection } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { events, messages, users } from '../src/db/schema/index.js';
import example from '../src/db/seed/example.js';
import { loadSeed } from '../src/db/seed/load.js';
import { fixture } from './helpers/fixtures.js';
import { fakeBrevoFetch } from './helpers/brevo.js';
import { fakeTelegramFetch, SAM_TELEGRAM_ID } from './helpers/memory.js';
import { startServer, type RunningServer } from './helpers/server.js';

const adminUrl = process.env.TEST_DATABASE_URL;
const TELEGRAM_SECRET = 't'.repeat(40);
const MAIL_SECRET = 'mail-secret-1234567890';
const ACTION_SECRET = 'a'.repeat(40);

describe.skipIf(!adminUrl)('Telegram and mail end to end (integration)', () => {
  const dbName = `hyperfocus_test_${randomBytes(4).toString('hex')}`;
  let connection: DbConnection;
  let server: RunningServer;
  let userId: number;
  const telegram = fakeTelegramFetch();
  const brevo = fakeBrevoFetch();
  const mails = brevo.sent;
  const telegramResults: TelegramOutcome[] = [];
  const mailResults: MailOutcome[] = [];

  async function admin(query: string) {
    const client = new pg.Client({ connectionString: adminUrl });
    await client.connect();
    try {
      await client.query(query);
    } finally {
      await client.end();
    }
  }

  beforeAll(async () => {
    await admin(`CREATE DATABASE ${dbName}`);
    const url = new URL(adminUrl!);
    url.pathname = `/${dbName}`;
    await runMigrations(url.toString());
    connection = connect(url.toString());
    userId = (await loadSeed(connection.db, example)).userId;

    const userStore = createDbUserStore(connection.db);
    const messageStore = createDbMessageStore(connection.db);
    // Claude answers a greeting; "vandaag" and buttons never reach it.
    const claude = {
      callWithTools: vi.fn(async () => ({ text: 'Hoi Sam. Zal ik je focus laten zien?', toolCalls: [] })),
    } as unknown as AssistantDeps['claude'];
    const router = createAssistantRouter({ db: connection.db, claude });
    const client = new TelegramClient('test-token', telegram.fetchImpl);
    const delivery = createDelivery({
      telegram: new TelegramChannel(client, messageStore),
      email: new EmailChannel(
        new EmailSender(
          { apiKey: 'key', from: 'hallo@hyper-focus.invalid', replyTo: 'taken@in.hyper-focus.invalid' },
          brevo.fetchImpl,
        ),
        messageStore,
        { actionLinkSecret: ACTION_SECRET, baseUrl: 'https://hyper-focus.invalid' },
      ),
    });
    const quiet = { info: () => undefined, warn: () => undefined, error: console.error };

    const processUpdate = createTelegramProcessor({
      client,
      users: userStore,
      messages: messageStore,
      delivery,
      router,
      allowedUserIds: [SAM_TELEGRAM_ID],
      linkSecret: ACTION_SECRET,
      log: quiet,
    });
    const processMail = createMailProcessor({
      users: userStore,
      messages: messageStore,
      delivery,
      router,
      allowedSenders: [example.user.email],
      log: quiet,
    });

    server = await startServer(
      createApp({
        telegram: {
          secretToken: TELEGRAM_SECRET,
          onUpdate: async (body) => void telegramResults.push(await processUpdate(body)),
        },
        mail: { secret: MAIL_SECRET, onMail: async (fields) => void mailResults.push(await processMail(fields)) },
        actions: {
          secret: ACTION_SECRET,
          baseUrl: 'https://hyper-focus.invalid',
          users: userStore,
          messages: messageStore,
          router,
        },
      }),
    );
  });

  afterAll(async () => {
    await server?.close();
    await connection?.close();
    await admin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  });

  async function postTelegram(body: unknown, secret = TELEGRAM_SECRET) {
    const before = telegramResults.length;
    const started = Date.now();
    const response = await fetch(`${server.baseUrl}/webhooks/telegram`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
      body: JSON.stringify(body),
    });
    const ms = Date.now() - started;
    if (response.status === 200) await vi.waitFor(() => expect(telegramResults.length).toBe(before + 1));
    return { status: response.status, ms, outcome: telegramResults[before] };
  }

  async function postMail(item: unknown) {
    const before = mailResults.length;
    const response = await fetch(`${server.baseUrl}/webhooks/mail/${MAIL_SECRET}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [item] }),
    });
    await vi.waitFor(() => expect(mailResults.length).toBe(before + 1));
    return { status: response.status, outcome: mailResults[before] };
  }

  it('links Telegram through /start with a one-time code', async () => {
    const code = createLinkCode(userId, ACTION_SECRET);
    const { status, outcome } = await postTelegram({
      update_id: 400001,
      message: {
        message_id: 1,
        from: { id: SAM_TELEGRAM_ID, first_name: 'Sam' },
        chat: { id: SAM_TELEGRAM_ID, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: `/start ${code}`,
      },
    });
    expect(status).toBe(200);
    expect(outcome).toBe('linked');
    const [user] = await connection.db.select().from(users).where(eq(users.id, userId));
    expect(user).toMatchObject({ telegramUserId: SAM_TELEGRAM_ID, telegramChatId: SAM_TELEGRAM_ID });
  });

  it('answers a Telegram message and stores both sides', async () => {
    const { status, ms, outcome } = await postTelegram(fixture('telegram', 'text'));
    expect(status).toBe(200);
    expect(ms).toBeLessThan(1000);
    expect(outcome).toBe('processed');
    expect(telegram.sent().at(-1)?.body.text).toContain('Hoi Sam');

    const rows = await connection.db.select().from(messages).where(eq(messages.externalId, 'u:500001'));
    expect(rows).toHaveLength(1);
  });

  it('processes a duplicate Telegram delivery once', async () => {
    const sentBefore = telegram.sent().length;
    const { outcome } = await postTelegram(fixture('telegram', 'text'));
    expect(outcome).toBe('duplicate');
    expect(telegram.sent()).toHaveLength(sentBefore);
  });

  it('handles a button tap once and removes the keyboard', async () => {
    const first = await postTelegram(fixture('telegram', 'callback'));
    expect(first.outcome).toBe('processed');
    expect(telegram.calls.some((call) => call.method === 'editMessageReplyMarkup')).toBe(true);
    expect(telegram.sent().at(-1)?.body.text).toContain('Offerte bakkerij afmaken');

    const second = await postTelegram(fixture('telegram', 'callback-second-tap'));
    expect(second.outcome).toBe('duplicate');
  });

  it('returns 401 for a wrong secret token', async () => {
    const { status } = await postTelegram(fixture('telegram', 'text'), 'x'.repeat(40));
    expect(status).toBe(401);
  });

  it('ignores an unknown Telegram user', async () => {
    const count = (await connection.db.select().from(messages)).length;
    const { outcome } = await postTelegram(fixture('telegram', 'unknown-user'));
    expect(outcome).toBe('ignored');
    expect(await connection.db.select().from(messages)).toHaveLength(count);
  });

  it('answers a mail reply by mail, and its action link works once', async () => {
    const { status, outcome } = await postMail(fixture('mail', 'reply-gmail'));
    expect(status).toBe(200);
    expect(outcome).toBe('processed');

    const reply = mails.at(-1)?.body;
    expect(reply?.subject).toBe('Re: Bericht van Hyper&Focus');
    const link = /Start 1: (https:\/\/hyper-focus\.invalid\/a\/\S+)/.exec(reply?.textContent ?? '')?.[1];
    expect(link).toBeDefined();

    const path = new URL(link!).pathname;
    const first = await fetch(`${server.baseUrl}${path}`, { method: 'POST' });
    expect(first.status).toBe(200);
    expect(await first.text()).toContain('Begin met');

    const second = await fetch(`${server.baseUrl}${path}`, { method: 'POST' });
    expect(second.status).toBe(410);

    const used = await connection.db.select().from(messages).where(eq(messages.type, 'action_link'));
    expect(used).toHaveLength(1);
    const sent = await connection.db.select().from(events).where(eq(events.name, 'email_sent'));
    expect(sent).toHaveLength(1);
  });

  it('processes a duplicate Message-ID once', async () => {
    const before = mails.length;
    const { outcome } = await postMail(fixture('mail', 'reply-gmail'));
    expect(outcome).toBe('duplicate');
    expect(mails).toHaveLength(before);
  });
});
