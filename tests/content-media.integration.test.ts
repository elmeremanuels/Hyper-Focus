import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { deleteUserData } from '../src/core/privacy.js';
import { cleanupWeekMedia, type MediaConfig } from '../src/content/media.js';
import { planBundle } from '../src/content/planner.js';
import { approvalMessage } from '../src/content/posts.js';
import { checkScheduledPosts } from '../src/content/status.js';
import { clientChannels, clients, contentPosts, users, userSettings } from '../src/db/schema/index.js';
import { encryptToken } from '../src/lib/crypto.js';
import { fakeBuffer, GOOD_KEY } from './helpers/buffer.js';
import { scriptedClaude } from './helpers/claude.js';
import { startServer } from './helpers/server.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

const ENCRYPTION_KEY = 'test-encryption-key-for-content';
const FOLDER = 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQ?usp=sharing';
const MONDAY_17 = new Date('2026-10-12T15:00:00Z');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

/** A fake Drive API: two photos and a PDF in the folder, every download a tiny JPEG. */
function fakeDrive() {
  const requests: string[] = [];
  const fetchImpl = (async (url: string) => {
    requests.push(String(url));
    if (String(url).includes('alt=media')) return new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } });
    return Response.json({
      files: [
        { id: 'photoBeach01', name: 'strand-ademsessie.jpg', description: 'Groep op het strand', mimeType: 'image/jpeg', size: '2000' },
        { id: 'photoStudio2', name: 'studio-ochtendlicht.jpg', mimeType: 'image/jpeg', size: '3000' },
        { id: 'pdfPrices003', name: 'prijzen.pdf', mimeType: 'application/pdf', size: '100' },
      ],
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

describe.skipIf(!adminUrl)('content images, status and cleanup (integration)', { timeout: 30_000 }, () => {
  const t = useTestDatabase();
  const db = () => t.connection.db;
  const buffer = fakeBuffer();
  const drive = fakeDrive();
  const dir = mkdtempSync(join(tmpdir(), 'hf-media-'));
  const media: MediaConfig = { dir, baseUrl: 'https://hyper-focus.invalid', googleApiKey: 'google-test-key', fetchImpl: drive.fetchImpl };
  const deps = { encryptionKey: ENCRYPTION_KEY, buffer: buffer.factory, media };
  let clientId = 0;
  const posts = () => db().select().from(contentPosts).where(eq(contentPosts.userId, t.userId)).orderBy(contentPosts.id);
  const plan = (claude: ReturnType<typeof scriptedClaude>, now = MONDAY_17) => planBundle({ db: db(), userId: t.userId, timezone: 'Europe/Amsterdam', now, claude, media });

  beforeAll(async () => {
    await db().update(users).set({ timezone: 'Europe/Amsterdam' }).where(eq(users.id, t.userId));
    await db().update(userSettings).set({ contentEnabled: true }).where(eq(userSettings.userId, t.userId));
    const [client] = await db()
      .insert(clients)
      .values({ userId: t.userId, name: 'Studio Rust', socialsEnabled: true, bufferApiKeyEnc: encryptToken(GOOD_KEY, ENCRYPTION_KEY), photoFolderUrl: FOLDER })
      .returning({ id: clients.id });
    clientId = client!.id;
    await db().insert(clientChannels).values([
      { userId: t.userId, clientId, bufferChannelId: 'ch_ig', service: 'instagram', name: 'studiorust', days: [2], postTime: '10:00' },
      { userId: t.userId, clientId, bufferChannelId: 'ch_li', service: 'linkedin', name: 'Rust', days: [], postTime: '08:30' },
    ]);
  });

  it('stores the chosen Drive photo and serves it; a meme goes by URL', async () => {
    const claude = scriptedClaude([
      {
        tools: [
          {
            name: 'plan_posts',
            input: {
              posts: [{ moment: 1, text: 'Adem met ons mee aan zee.', photo: 1 }],
              extra: { channel: 2, text: 'Elke maandag weer.', reason: 'Je plande een nieuwe reeks.', meme: { template: 'drake', top: 'Mailen op maandag', bottom: 'Ademen op maandag?' } },
            },
          },
        ],
      },
    ]);
    const ids = await plan(claude);
    expect(ids).toHaveLength(2);

    const system = claude.callWithTools.mock.calls[0]?.[0].system ?? '';
    expect(system).toContain('1. strand-ademsessie.jpg — Groep op het strand');
    expect(system).toContain('2. studio-ochtendlicht.jpg');
    expect(system).not.toContain('prijzen.pdf');
    expect(system).toContain('- drake: Drake');
    expect(new URL(drive.requests[0]!).searchParams.get('q')).toContain("'1AbCdEfGhIjKlMnOpQ' in parents");

    const [ig, extra] = await posts();
    expect(ig?.mediaSource).toBe('drive');
    expect(ig?.mediaUrl).toMatch(/^https:\/\/hyper-focus\.invalid\/media\/d-photoBeach01-[0-9a-f]{24}\.jpg$/);
    expect(extra).toMatchObject({ mediaSource: 'meme', mediaUrl: 'https://api.memegen.link/images/drake/Mailen_op_maandag/Ademen_op_maandag~q.jpg' });

    const file = ig!.mediaUrl!.split('/media/')[1]!;
    expect(readFileSync(join(dir, file))).toEqual(JPEG);
    const approval = await approvalMessage({ db: db(), userId: t.userId, timezone: 'Europe/Amsterdam', now: MONDAY_17 }, ig!.id);
    expect(approval.text).toContain(`Beeld: ${ig!.mediaUrl}`);

    const s = await startServer(createApp({ mediaDir: dir }));
    try {
      const res = await fetch(`${s.baseUrl}/media/${file}`);
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer())).toEqual(JPEG);
      expect((await fetch(`${s.baseUrl}/media/bestaat-niet.jpg`)).status).toBe(404);
      expect((await fetch(`${s.baseUrl}/media/..%2F..%2Fetc%2Fpasswd`)).status).toBe(403);
    } finally {
      await s.close();
    }
  });

  it('leaves out a meme when the client card says no memes', async () => {
    // A note this week, so Claude is asked even without rhythm moments.
    await db().update(clients).set({ memesAllowed: false, notes: '[13 okt] Nieuwe reeks gepland' }).where(eq(clients.id, clientId));
    const claude = scriptedClaude([
      { tools: [{ name: 'plan_posts', input: { posts: [], extra: { channel: 2, text: 'Nog een post.', reason: 'Er gebeurde iets.', meme: { template: 'fine', top: 'a', bottom: 'b' } } } }] },
    ]);
    await plan(claude, new Date('2026-10-13T15:00:00Z'));
    expect(claude.callWithTools.mock.calls[0]?.[0].system).toContain('(geen memes)');
    expect((await posts()).at(-1)).toMatchObject({ mediaSource: 'none', mediaUrl: null });
  });

  it('marks posts as sent, and reports a failure with Buffer’s reason', async () => {
    const [ig, extra] = await posts();
    await db().update(contentPosts).set({ status: 'scheduled', bufferPostId: 'buf_ig' }).where(eq(contentPosts.id, ig!.id));
    await db().update(contentPosts).set({ status: 'scheduled', bufferPostId: 'buf_li' }).where(eq(contentPosts.id, extra!.id));
    buffer.setStatus('buf_ig', 'sent');
    buffer.setStatus('buf_li', 'error', 'Afbeelding te klein');
    const told: string[] = [];
    const notify = async (_userId: number, text: string) => void told.push(text);

    // Within ten minutes of the moment Buffer is not asked yet (LinkedIn 06:30, Instagram 08:00 UTC).
    expect(await checkScheduledPosts(db(), deps, new Date('2026-10-13T06:35:00Z'), notify)).toEqual({ sent: 0, failed: 0 });
    const result = await checkScheduledPosts(db(), deps, new Date('2026-10-13T09:00:00Z'), notify);
    expect(result).toEqual({ sent: 1, failed: 1 });
    expect((await posts())[0]?.status).toBe('sent');
    expect((await posts())[1]).toMatchObject({ status: 'failed', error: 'Afbeelding te klein' });
    expect(told).toEqual(['Buffer kon de post voor Studio Rust op Rust (dinsdag 13 okt 08:30) niet plaatsen: Afbeelding te klein']);
  });

  it('deletes the photos of sent posts once their week is over', async () => {
    const ig = (await posts())[0]!;
    const file = join(dir, ig.mediaUrl!.split('/media/')[1]!);
    // Still the same week: kept.
    expect(await cleanupWeekMedia(db(), media, new Date('2026-10-18T20:00:00Z'))).toBe(0);
    expect(existsSync(file)).toBe(true);
    // Monday after: gone, and the post no longer points to it.
    expect(await cleanupWeekMedia(db(), media, new Date('2026-10-19T08:00:00Z'))).toBe(1);
    expect(existsSync(file)).toBe(false);
    expect((await posts())[0]?.mediaUrl).toBeNull();
  });

  it('keeps the photo of a failed post, so "Opnieuw" still has it', async () => {
    writeFileSync(join(dir, 'd-photoStudio2-0123456789abcdef01234567.jpg'), JPEG);
    const [row] = await db()
      .insert(contentPosts)
      .values({ userId: t.userId, clientId, channelId: (await posts())[0]!.channelId, text: 'Mislukt', status: 'failed', mediaUrl: 'https://hyper-focus.invalid/media/d-photoStudio2-0123456789abcdef01234567.jpg', mediaSource: 'drive', dueAt: new Date('2026-10-06T08:00:00Z') })
      .returning({ id: contentPosts.id });
    await cleanupWeekMedia(db(), media, new Date('2026-10-19T08:00:00Z'));
    expect(existsSync(join(dir, 'd-photoStudio2-0123456789abcdef01234567.jpg'))).toBe(true);
    expect((await db().select().from(contentPosts).where(eq(contentPosts.id, row!.id)))[0]?.mediaUrl).not.toBeNull();
  });

  it('removes the user’s photos when the account is deleted', async () => {
    const name = 'd-photoStudio2-0123456789abcdef01234567.jpg';
    expect(existsSync(join(dir, name))).toBe(true);
    expect(await deleteUserData(db(), t.userId, undefined, dir)).toBe(true);
    expect(existsSync(join(dir, name))).toBe(false);
  });
});
