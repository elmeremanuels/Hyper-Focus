import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createAssistantRouter } from '../src/conversation/assistant.js';
import { exportUserData } from '../src/core/privacy.js';
import { clients, contentPosts, users } from '../src/db/schema/index.js';
import { createSession } from '../src/web/auth/sessions.js';
import { fakeBuffer, GOOD_KEY } from './helpers/buffer.js';
import { scriptedClaude } from './helpers/claude.js';
import { startServer } from './helpers/server.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

const BASE = 'https://app.hyper-focus.invalid';
const NOW = new Date('2026-10-12T07:00:00Z'); // Monday 09:00 in Amsterdam
const ENCRYPTION_KEY = 'test-encryption-key-for-content';
const quiet = { error: () => undefined, warn: () => undefined };

describe.skipIf(!adminUrl)('content module (integration)', () => {
  const t = useTestDatabase();
  const db = () => t.connection.db;
  const buffer = fakeBuffer();
  const content = { encryptionKey: ENCRYPTION_KEY, buffer: buffer.factory };
  let cookie = '';
  let clientId = 0;

  beforeAll(async () => {
    await db().update(users).set({ timezone: 'Europe/Amsterdam' }).where(eq(users.id, t.userId));
    cookie = `hf_session=${(await createSession(db(), t.userId, NOW)).token}`;
    const [client] = await db().insert(clients).values({ userId: t.userId, name: 'Studio Rust' }).returning({ id: clients.id });
    clientId = client!.id;
  });

  async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown) {
    const s = await startServer(createApp({ dashboard: { db: db(), dashboardBaseUrl: BASE, now: () => NOW, content } }));
    try {
      const res = await fetch(`${s.baseUrl}${path}`, {
        method,
        headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: res.status, body: (await res.json()) as T };
    } finally {
      await s.close();
    }
  }
  type Overview = { contentEnabled: boolean; clients: Array<{ id: number; content: null | { profile: unknown[]; socialsEnabled: boolean; bufferConnected: boolean; channels: Array<{ bufferChannelId: string; days: number[]; time: string }> } }> };
  const card = async () => (await call<Overview>('GET', '/api/projects')).body.clients.find((c) => c.id === clientId)?.content;

  it('shows nothing about content while the module is off', async () => {
    const o = (await call<Overview>('GET', '/api/projects')).body;
    expect(o.contentEnabled).toBe(false);
    expect(o.clients.every((c) => c.content === null)).toBe(true);
    expect((await call('PATCH', `/api/clients/${clientId}/content`, { socialsEnabled: true })).status).toBe(409);
  });

  it('turns the module on and fills the client card with free fields', async () => {
    expect((await call('PATCH', '/api/settings', { contentEnabled: true })).status).toBe(200);
    expect((await call<{ contentEnabled: boolean }>('GET', '/api/settings')).body.contentEnabled).toBe(true);
    const profile = [
      { label: 'Doelgroep', value: 'Ondernemers met stress' },
      { label: 'Tone of voice', value: 'Rustig, warm, je-vorm' },
      { label: 'Leeg', value: '' },
    ];
    expect((await call('PATCH', `/api/clients/${clientId}/content`, { profile, socialsEnabled: true })).status).toBe(200);
    expect(await card()).toMatchObject({ profile: profile.slice(0, 2), socialsEnabled: true, bufferConnected: false, channels: [] });
  });

  it('checks the Buffer key with Buffer and stores it encrypted', async () => {
    const bad = await call('PUT', `/api/clients/${clientId}/buffer`, { apiKey: 'wrong-key-123456' });
    expect(bad).toMatchObject({ status: 400, body: { error: 'Buffer herkent deze sleutel niet' } });
    const good = await call<{ available: Array<{ id: string }> }>('PUT', `/api/clients/${clientId}/buffer`, { apiKey: GOOD_KEY });
    expect(good.status).toBe(200);
    expect(good.body.available.map((c) => c.id)).toEqual(['ch_ig', 'ch_li', 'ch_fb', 'ch_th']);
    const [row] = await db().select({ key: clients.bufferApiKeyEnc }).from(clients).where(eq(clients.id, clientId));
    expect(row?.key).toBeTruthy();
    expect(row?.key).not.toContain(GOOD_KEY);
    expect((await card())?.bufferConnected).toBe(true);
  });

  it('keeps at most three channels, each with its own rhythm', async () => {
    const four = ['ch_ig', 'ch_li', 'ch_fb', 'ch_th'].map((id) => ({ bufferChannelId: id, days: [2], time: '10:00' }));
    expect((await call('PUT', `/api/clients/${clientId}/channels`, { channels: four })).status).toBe(400);
    expect((await call('PUT', `/api/clients/${clientId}/channels`, { channels: [{ bufferChannelId: 'ch_xx', days: [], time: '10:00' }] })).status).toBe(400);
    const res = await call('PUT', `/api/clients/${clientId}/channels`, {
      channels: [
        { bufferChannelId: 'ch_ig', days: [4, 2, 2], time: '10:00' },
        { bufferChannelId: 'ch_li', days: [], time: '08:30' },
      ],
    });
    expect(res.status).toBe(200);
    expect((await card())?.channels).toEqual([
      { bufferChannelId: 'ch_ig', name: 'studiorust', service: 'instagram', days: [2, 4], time: '10:00' },
      { bufferChannelId: 'ch_li', name: 'Rust', service: 'linkedin', days: [], time: '08:30' },
    ]);
  });

  const router = (claude?: ReturnType<typeof scriptedClaude>) =>
    createAssistantRouter({ db: db(), claude: claude as never, now: () => NOW, log: quiet, content });
  const posts = () => db().select().from(contentPosts).where(eq(contentPosts.userId, t.userId)).orderBy(contentPosts.id);

  it('puts a post for approval in Telegram, one per channel', async () => {
    const claude = scriptedClaude([{ tools: [{ name: 'draft_post', input: { client_name: 'Studio Rust', text: 'Adem in. Adem uit. Nieuwe sessies vanaf dinsdag.' } }] }]);
    const replies = await router(claude)({ kind: 'text', userId: t.userId, text: 'post voor Studio Rust: Adem in. Adem uit. Nieuwe sessies vanaf dinsdag.' });
    expect(replies).toHaveLength(2);
    expect(replies[0]?.text).toBe(
      'Post voor Studio Rust · studiorust (Instagram)\nGepland: dinsdag 13 okt 10:00\n\nAdem in. Adem uit. Nieuwe sessies vanaf dinsdag.',
    );
    expect(replies[1]?.text).toContain('Gepland: volgende vrije plek in Buffer');
    const [ig] = await posts();
    expect(replies[0]?.buttons?.map((b) => b.id)).toEqual([`cp:${ig!.id}:ok`, `cp:${ig!.id}:edit`, `cp:${ig!.id}:skip`]);
    expect(ig).toMatchObject({ status: 'pending_approval', dueAt: new Date('2026-10-13T08:00:00Z') });
    expect(buffer.posts).toHaveLength(0);
  });

  it('schedules in Buffer only after "Goed", and only once', async () => {
    const [ig] = await posts();
    const replies = await router()({ kind: 'button', userId: t.userId, buttonId: `cp:${ig!.id}:ok`, title: '' });
    expect(replies[0]?.text).toBe('Ingepland: dinsdag 13 okt 10:00 op studiorust.');
    expect(buffer.posts).toEqual([
      { key: GOOD_KEY, channelId: 'ch_ig', service: 'instagram', text: 'Adem in. Adem uit. Nieuwe sessies vanaf dinsdag.', dueAt: new Date('2026-10-13T08:00:00Z'), imageUrl: null },
    ]);
    expect((await posts())[0]).toMatchObject({ status: 'scheduled', bufferPostId: 'buf_1', approvedAt: NOW });
    const again = await router()({ kind: 'button', userId: t.userId, buttonId: `cp:${ig!.id}:ok`, title: '' });
    expect(again[0]?.text).toBe('Deze post is al ingepland.');
    expect(buffer.posts).toHaveLength(1);
  });

  it('rewrites a post with "Aanpassen" and shows it again', async () => {
    const li = (await posts())[1]!;
    const ask = await router()({ kind: 'button', userId: t.userId, buttonId: `cp:${li.id}:edit`, title: '' });
    expect(ask[0]?.text).toBe('Wat moet er anders? Typ of spreek het in. Je kunt ook de nieuwe tekst sturen.');
    const claude = scriptedClaude([{ tools: [{ name: 'rewrite_post', input: { text: 'Adem in, adem uit. Vanaf dinsdag nieuwe sessies.' } }] }]);
    const replies = await router(claude)({ kind: 'text', userId: t.userId, text: 'iets korter' });
    expect(replies[0]?.text).toContain('Adem in, adem uit. Vanaf dinsdag nieuwe sessies.');
    expect(claude.callWithTools.mock.calls[0]?.[0].system).toContain('Tone of voice: Rustig, warm, je-vorm');
    expect((await posts())[1]).toMatchObject({ status: 'pending_approval', text: 'Adem in, adem uit. Vanaf dinsdag nieuwe sessies.' });
  });

  it('marks a refused post as failed with a retry, then skips it', async () => {
    const li = (await posts())[1]!;
    buffer.failNext('Text is too long');
    const failed = await router()({ kind: 'button', userId: t.userId, buttonId: `cp:${li.id}:ok`, title: '' });
    expect(failed[0]).toEqual({ text: 'Buffer weigerde de post: Text is too long', buttons: [{ id: `cp:${li.id}:ok`, title: 'Opnieuw' }] });
    expect((await posts())[1]).toMatchObject({ status: 'failed', error: 'Text is too long' });
    const skipped = await router()({ kind: 'button', userId: t.userId, buttonId: `cp:${li.id}:skip`, title: '' });
    expect(skipped[0]?.text).toBe('Overgeslagen. Deze post gaat niet live.');
    expect((await posts())[1]?.status).toBe('skipped');
  });

  it('says so when the module is off or a client has no channels', async () => {
    const [other] = await db().insert(clients).values({ userId: t.userId, name: 'Fietsenmaker Jansen' }).returning({ id: clients.id });
    const claude = scriptedClaude([{ tools: [{ name: 'draft_post', input: { client_name: 'Jansen', text: 'Nieuwe fietsen binnen.' } }] }, { text: 'Bij Fietsenmaker Jansen zijn nog geen kanalen gekoppeld.' }]);
    await router(claude)({ kind: 'text', userId: t.userId, text: 'post voor Jansen: Nieuwe fietsen binnen.' });
    const toolResult = claude.callWithTools.mock.calls[1]?.[0].messages.at(-1);
    expect(JSON.stringify(toolResult)).toContain('nog geen kanalen gekoppeld');
    expect((await posts()).filter((p) => p.clientId === other!.id)).toHaveLength(0);
  });

  it('leaves the Buffer key out of the data export', async () => {
    const data = (await exportUserData(db(), t.userId, NOW)) as unknown as Record<string, Array<Record<string, unknown>>>;
    expect(data.clients?.some((c) => 'bufferApiKeyEnc' in c)).toBe(false);
    expect(data.client_channels).toHaveLength(2);
    expect(data.content_posts).toHaveLength(2);
  });

  it('removes key and channels when Buffer is disconnected', async () => {
    expect((await call('DELETE', `/api/clients/${clientId}/buffer`)).status).toBe(200);
    expect(await card()).toMatchObject({ bufferConnected: false, channels: [] });
    // The posts go with their channel.
    expect(await db().select().from(contentPosts).where(and(eq(contentPosts.userId, t.userId), eq(contentPosts.clientId, clientId)))).toHaveLength(0);
  });
});
