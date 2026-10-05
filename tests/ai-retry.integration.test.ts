import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createAssistantRouter, TEXTS } from '../src/conversation/assistant.js';
import { createDbMessageStore } from '../src/core/messages.js';
import { createDbUserStore } from '../src/core/users.js';
import { scheduledNudges, users as usersTable } from '../src/db/schema/index.js';
import { runMaintenance } from '../src/proactive/maintenance.js';
import { sendDueNudges } from '../src/proactive/sender.js';
import { fakeDelivery } from './helpers/delivery.js';
import { scriptedClaude } from './helpers/claude.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

const AT = new Date('2026-10-07T09:00:00Z'); // 11:00 in Amsterdam
const later = (minutes: number) => new Date(AT.getTime() + minutes * 60_000);
const quiet = { error: () => undefined, warn: () => undefined };

describe.skipIf(!adminUrl)('wait text and queue when the AI is down (integration)', () => {
  const t = useTestDatabase();
  const db = () => t.connection.db;
  const retries = async () =>
    db()
      .select()
      .from(scheduledNudges)
      .where(and(eq(scheduledNudges.userId, t.userId), eq(scheduledNudges.kind, 'ai_retry')));
  beforeAll(async () => {
    await db().update(usersTable).set({ telegramChatId: 111222333, preferredChannel: 'telegram' }).where(eq(usersTable.id, t.userId));
  });
  const down = { callWithTools: vi.fn(async () => Promise.reject(new Error('Your credit balance is too low to access the Anthropic API'))) };

  it('answers with the wait text, keeps the message and alerts on a credit problem', async () => {
    const alert = vi.fn(async () => undefined);
    const router = createAssistantRouter({ db: db(), claude: down as never, now: () => AT, log: quiet, alert });
    const replies = await router({ kind: 'text', userId: t.userId, text: 'Bel Boho over de offerte' });

    expect(replies).toEqual([{ text: TEXTS.aiOut }]);
    expect(alert).toHaveBeenCalledWith('ai_credit', 'Het tegoed bij de AI-leverancier is op.');
    const [queued] = await retries();
    expect(queued).toMatchObject({ status: 'pending', scheduledForUtc: later(5), payload: { text: 'Bel Boho over de offerte', source: 'telegram' } });
  });

  it('tries again later, and answers once the AI is back', async () => {
    const { delivery, telegram } = fakeDelivery(createDbMessageStore(db()));
    const users = createDbUserStore(db());
    const failing = vi.fn(async () => Promise.reject(new Error('overloaded')));
    await sendDueNudges({ db: db(), delivery, users, log: quiet, retry: failing }, later(6));
    expect(failing).toHaveBeenCalledWith({ userId: t.userId, text: 'Bel Boho over de offerte', source: 'telegram' });
    expect((await retries())[0]).toMatchObject({ status: 'pending', scheduledForUtc: later(16) });
    expect(telegram.sent()).toHaveLength(0);

    const claude = scriptedClaude([{ tools: [{ name: 'add_task', input: { title: 'Bel Boho over de offerte', estimated_minutes: 10 } }] }, { text: 'Staat erin.' }]);
    const router = createAssistantRouter({ db: db(), claude: claude as never, now: () => later(17), log: quiet });
    await sendDueNudges({ db: db(), delivery, users, log: quiet, retry: (m) => router({ kind: 'text', ...m, queued: true }) }, later(17));
    expect(telegram.sent()).toHaveLength(1);
    expect((await retries())[0]?.status).toBe('sent');
  });

  it('asks to send it again after 12 hours', async () => {
    const router = createAssistantRouter({ db: db(), claude: down as never, now: () => AT, log: quiet });
    await router({ kind: 'text', userId: t.userId, text: 'Factuur Jansen versturen' });
    const { delivery, telegram } = fakeDelivery(createDbMessageStore(db()));
    const retry = vi.fn(async () => Promise.reject(new Error('still down')));
    // The queued row sits pending; jump past the give-up time.
    await db()
      .update(scheduledNudges)
      .set({ scheduledForUtc: later(13 * 60) })
      .where(and(eq(scheduledNudges.kind, 'ai_retry'), eq(scheduledNudges.status, 'pending')));
    await sendDueNudges({ db: db(), delivery, users: createDbUserStore(db()), log: quiet, retry }, later(13 * 60));

    expect(retry).not.toHaveBeenCalled();
    expect(String(telegram.sent()[0]?.body.text)).toBe('Je bericht van woensdag 11:00 kon ik niet verwerken. Wil je het opnieuw sturen?\n"Factuur Jansen versturen"');
  });

  it('removes handled queue rows after a day', async () => {
    const result = await runMaintenance(db(), later(3 * 24 * 60));
    expect(result.messages).toBeGreaterThanOrEqual(2);
    expect(await retries()).toHaveLength(0);
  });
});
