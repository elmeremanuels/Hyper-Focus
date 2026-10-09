import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAssistantRouter } from '../src/conversation/assistant.js';
import { expireWaitingPosts } from '../src/content/planner.js';
import { approvePost } from '../src/content/posts.js';
import { createDbMessageStore } from '../src/core/messages.js';
import { createDbUserStore } from '../src/core/users.js';
import { clientChannels, clients, contentPosts, projects, scheduledNudges, tasks, users, userSettings } from '../src/db/schema/index.js';
import { encryptToken } from '../src/lib/crypto.js';
import { planDay } from '../src/proactive/planner.js';
import { sendDueNudges } from '../src/proactive/sender.js';
import { fakeBuffer, GOOD_KEY } from './helpers/buffer.js';
import { scriptedClaude } from './helpers/claude.js';
import { fakeDelivery } from './helpers/delivery.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

const ENCRYPTION_KEY = 'test-encryption-key-for-content';
const quiet = { error: () => undefined, warn: () => undefined };
const MONDAY = new Date('2026-10-12T06:00:00Z'); // 08:00 in Amsterdam
const BUNDLE = new Date('2026-10-12T15:00:30Z'); // 17:00

describe.skipIf(!adminUrl)('content bundle (integration)', { timeout: 30_000 }, () => {
  const t = useTestDatabase();
  const db = () => t.connection.db;
  const buffer = fakeBuffer();
  const deps = { encryptionKey: ENCRYPTION_KEY, buffer: buffer.factory };
  let clientId = 0;
  const kit = () => fakeDelivery(createDbMessageStore(db()));
  const posts = () => db().select().from(contentPosts).where(eq(contentPosts.userId, t.userId)).orderBy(contentPosts.id);

  beforeAll(async () => {
    await db().update(users).set({ timezone: 'Europe/Amsterdam', telegramChatId: 111222333, preferredChannel: 'telegram' }).where(eq(users.id, t.userId));
    const [client] = await db()
      .insert(clients)
      .values({
        userId: t.userId,
        name: 'Studio Rust',
        notes: '[8 okt] Mo wil meer aandacht voor de ademsessies',
        socialsEnabled: true,
        bufferApiKeyEnc: encryptToken(GOOD_KEY, ENCRYPTION_KEY),
        profile: [{ label: 'Tone of voice', value: 'Rustig en warm' }],
      })
      .returning({ id: clients.id });
    clientId = client!.id;
    await db().insert(clientChannels).values([
      { userId: t.userId, clientId, bufferChannelId: 'ch_ig', service: 'instagram', name: 'studiorust', days: [2, 4], postTime: '10:00' },
      { userId: t.userId, clientId, bufferChannelId: 'ch_li', service: 'linkedin', name: 'Rust', days: [], postTime: '08:30' },
    ]);
    const [project] = await db().insert(projects).values({ userId: t.userId, clientId, title: 'Website Studio Rust' }).returning({ id: projects.id });
    await db().insert(tasks).values({ userId: t.userId, projectId: project!.id, title: 'Nieuwe website live zetten', status: 'done', completedAt: new Date('2026-10-12T09:00:00Z'), source: 'web' });
  });

  it('plans no bundle while the module is off', async () => {
    const plan = await planDay(db(), t.userId, 'Europe/Amsterdam', MONDAY);
    expect(plan?.nudges.some((n) => n.kind === 'content_bundle')).toBe(false);
  });

  it('plans the bundle at 17:00 on a work day once the module is on', async () => {
    await db().update(userSettings).set({ contentEnabled: true }).where(eq(userSettings.userId, t.userId));
    await db().delete(scheduledNudges).where(eq(scheduledNudges.userId, t.userId));
    const plan = await planDay(db(), t.userId, 'Europe/Amsterdam', new Date('2026-10-13T06:00:00Z'));
    // Tuesday is planned fresh; Monday already had its plan, so add Monday's bundle by hand.
    expect(plan?.nudges.find((n) => n.kind === 'content_bundle')?.scheduledForUtc).toEqual(new Date('2026-10-13T15:00:00Z'));
    await db().delete(scheduledNudges).where(eq(scheduledNudges.userId, t.userId));
    await db().insert(scheduledNudges).values({ userId: t.userId, kind: 'content_bundle', scheduledForUtc: new Date('2026-10-12T15:00:00Z'), payload: { localDate: '2026-10-12' } });
  });

  it('tries again later when Claude is out', async () => {
    const { delivery, telegram } = kit();
    const failing = { callWithTools: async () => Promise.reject(new Error('overloaded')) };
    const result = await sendDueNudges({ db: db(), delivery, users: createDbUserStore(db()), log: quiet, content: { claude: failing as never, deps } }, BUNDLE);
    expect(result.postponed).toBe(1);
    expect(telegram.sent()).toHaveLength(0);
    await db().update(scheduledNudges).set({ scheduledForUtc: new Date('2026-10-12T15:00:00Z') }).where(eq(scheduledNudges.kind, 'content_bundle'));
  });

  it('sends one bundle: a header with "Alles goed", a post per moment and an extra post with its reason', async () => {
    const { delivery, telegram } = kit();
    const claude = scriptedClaude([
      {
        tools: [
          {
            name: 'plan_posts',
            input: {
              posts: [{ moment: 1, text: 'Dinsdag: even stilstaan bij je adem.' }],
              extra: { channel: 2, text: 'Onze nieuwe website staat live.', reason: 'Je zette de nieuwe website live.' },
            },
          },
        ],
      },
    ]);
    await sendDueNudges({ db: db(), delivery, users: createDbUserStore(db()), log: quiet, content: { claude, deps } }, BUNDLE);

    const sent = telegram.sent().map((c) => c.body);
    expect(sent).toHaveLength(3);
    expect(sent[0]?.text).toBe('2 posts klaar voor één klant. Keur ze per stuk goed, of alles in één keer.');
    expect(JSON.stringify(sent[0]?.reply_markup)).toContain('cpb:all');
    expect(String(sent[1]?.text)).toContain('Rust (LinkedIn)\nGepland: dinsdag 13 okt 08:30\nExtra post: Je zette de nieuwe website live.');
    expect(String(sent[2]?.text)).toContain('studiorust (Instagram)\nGepland: dinsdag 13 okt 10:00\n\nDinsdag: even stilstaan bij je adem.');

    // Claude saw the week, the client card and the moments.
    const call = claude.callWithTools.mock.calls[0]?.[0];
    expect(call?.tier).toBe('smart');
    expect(call?.system).toContain('Afgerond: Nieuwe website live zetten (Website Studio Rust)');
    expect(call?.system).toContain('Notitie: [8 okt] Mo wil meer aandacht voor de ademsessies');
    expect(call?.system).toContain('- Tone of voice: Rustig en warm');
    expect(call?.system).toContain('1. Instagram (studiorust), dinsdag 13 okt 10:00');

    // A reminder an hour before each post.
    const reminders = await db().select().from(scheduledNudges).where(and(eq(scheduledNudges.userId, t.userId), eq(scheduledNudges.kind, 'content_reminder')));
    expect(reminders.map((r) => r.scheduledForUtc.toISOString()).sort()).toEqual(['2026-10-13T05:30:00.000Z', '2026-10-13T07:00:00.000Z']);
  });

  it('approves everything with "Alles goed"', async () => {
    const router = createAssistantRouter({ db: db(), claude: undefined, now: () => new Date('2026-10-12T15:05:00Z'), log: quiet, content: deps });
    const replies = await router({ kind: 'button', userId: t.userId, buttonId: 'cpb:all', title: '' });
    expect(replies).toEqual([{ text: '2 posts ingepland.' }]);
    expect(buffer.posts.map((p) => p.channelId).sort()).toEqual(['ch_ig', 'ch_li']);
    expect((await posts()).every((p) => p.status === 'scheduled')).toBe(true);
  });

  it('skips the reminder once the post is approved, and sends it while it waits', async () => {
    const { delivery, telegram } = kit();
    // The reminders of the approved posts: nothing to say.
    await sendDueNudges({ db: db(), delivery, users: createDbUserStore(db()), log: quiet, content: { deps } }, new Date('2026-10-13T05:30:30Z'));
    expect(telegram.sent()).toHaveLength(0);

    const [waiting] = await db()
      .insert(contentPosts)
      .values({ userId: t.userId, clientId, channelId: (await posts())[0]!.channelId, text: 'Wacht nog', dueAt: new Date('2026-10-15T08:00:00Z') })
      .returning({ id: contentPosts.id });
    await db().insert(scheduledNudges).values({ userId: t.userId, kind: 'content_reminder', scheduledForUtc: new Date('2026-10-15T07:00:00Z'), payload: { postId: waiting!.id } });
    await sendDueNudges({ db: db(), delivery, users: createDbUserStore(db()), log: quiet, content: { deps } }, new Date('2026-10-15T07:00:30Z'));
    expect(String(telegram.sent()[0]?.body.text)).toMatch(/^Over een uur gepland en nog niet goedgekeurd\. Zonder akkoord gaat hij niet live\.\n\nPost voor Studio Rust/);
  });

  it('skips a post that was not approved in time', async () => {
    const at = new Date('2026-10-15T08:00:00Z');
    expect(await expireWaitingPosts(db(), at)).toBe(1);
    const skipped = (await posts()).find((p) => p.text === 'Wacht nog');
    expect(skipped).toMatchObject({ status: 'skipped', error: 'Niet op tijd goedgekeurd' });

    // Approving after the moment never posts late.
    const [late] = await db()
      .insert(contentPosts)
      .values({ userId: t.userId, clientId, channelId: skipped!.channelId, text: 'Te laat', dueAt: new Date('2026-10-15T08:00:00Z') })
      .returning({ id: contentPosts.id });
    const reply = await approvePost({ db: db(), userId: t.userId, timezone: 'Europe/Amsterdam', now: new Date('2026-10-15T08:01:00Z'), content: deps }, late!.id);
    expect(reply.text).toBe('Het geplande moment is voorbij. Deze post is overgeslagen.');
    expect(buffer.posts).toHaveLength(2);
  });

  it('does not write the same moment twice', async () => {
    await db().insert(scheduledNudges).values({ userId: t.userId, kind: 'content_bundle', scheduledForUtc: new Date('2026-10-12T15:10:00Z'), payload: { localDate: '2026-10-12' } });
    const claude = scriptedClaude([{ tools: [{ name: 'plan_posts', input: { posts: [], extra: null } }] }]);
    const { delivery, telegram } = kit();
    const result = await sendDueNudges({ db: db(), delivery, users: createDbUserStore(db()), log: quiet, content: { claude, deps } }, new Date('2026-10-12T15:10:30Z'));
    // Tuesday 10:00 already has its post: no moments left, so Claude only gets the week.
    expect(claude.callWithTools.mock.calls[0]?.[0].system).toContain('(geen: alleen een extra post als er iets te delen valt)');
    expect(result.skipped).toBe(1);
    expect(telegram.sent()).toHaveLength(0);
  });
});
