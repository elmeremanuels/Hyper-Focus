import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { TelegramClient } from '../src/channels/telegram/client.js';
import { createTelegramProcessor } from '../src/channels/telegram/processor.js';
import { createAssistantRouter } from '../src/conversation/assistant.js';
import { createDbMessageStore } from '../src/core/messages.js';
import { createDbUserStore } from '../src/core/users.js';
import { messages, projects, tasks, users } from '../src/db/schema/index.js';
import { scriptedClaude } from './helpers/claude.js';
import { fakeDelivery } from './helpers/delivery.js';
import { fixture } from './helpers/fixtures.js';
import { fakeTelegramFetch, SAM_TELEGRAM_ID } from './helpers/memory.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

describe.skipIf(!adminUrl)('voice messages (integration)', () => {
  const t = useTestDatabase();

  it('turns a voice message into a task under the client, keeping only the transcript', async () => {
    const db = t.connection.db;
    await db.update(users).set({ telegramUserId: SAM_TELEGRAM_ID, telegramChatId: SAM_TELEGRAM_ID }).where(eq(users.id, t.userId));
    const store = createDbMessageStore(db);
    const telegram = fakeTelegramFetch();
    const { delivery } = fakeDelivery(store);
    const claude = scriptedClaude([
      { tools: [{ name: 'add_task', input: { title: 'Banner maken voor Boho', estimated_minutes: 30, client_name: 'Boho' } }] },
      { text: 'Staat erin bij Boho.' },
    ]);
    const process = createTelegramProcessor({
      client: new TelegramClient('test-token', telegram.fetchImpl),
      users: createDbUserStore(db),
      messages: store,
      delivery,
      router: createAssistantRouter({ db, claude }),
      allowedUserIds: [SAM_TELEGRAM_ID],
      linkSecret: undefined,
      transcriber: { isConfigured: () => true, transcribe: async () => 'eh ja boho wil nog een banner voor de winkel' },
      log: { info: () => undefined, warn: () => undefined, error: console.error },
    });

    const started = Date.now();
    expect(await process(fixture('telegram', 'voice'))).toBe('processed');
    expect(Date.now() - started).toBeLessThan(8000);

    const [task] = await db.select().from(tasks).where(eq(tasks.title, 'Banner maken voor Boho'));
    expect(task?.source).toBe('voice');
    const [project] = await db.select().from(projects).where(eq(projects.id, task!.projectId));
    expect(project?.title).toBe('Nieuwsbrief Boho');

    const [inbound] = await db.select().from(messages).where(eq(messages.externalId, 'u:500005'));
    expect(inbound).toMatchObject({ type: 'audio', body: null, transcript: 'eh ja boho wil nog een banner voor de winkel' });
    expect(claude.callWithTools.mock.calls[0]![0].messages[0]).toEqual({
      role: 'user',
      content: 'eh ja boho wil nog een banner voor de winkel',
    });
  });
});
