import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAssistantRouter } from '../src/conversation/assistant.js';
import { sourceFromWords } from '../src/conversation/content.js';
import { storeImage, type MediaConfig } from '../src/content/media.js';
import { draftPosts } from '../src/content/posts.js';
import { clientChannels, clients, contentPostImages, contentPosts, ideas, tasks, users, userSettings } from '../src/db/schema/index.js';
import { encryptToken } from '../src/lib/crypto.js';
import { fakeBuffer, GOOD_KEY } from './helpers/buffer.js';
import { scriptedClaude } from './helpers/claude.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

const ENCRYPTION_KEY = 'test-encryption-key-for-content';
const NOW = new Date('2026-10-12T07:00:00Z'); // Monday 09:00 in Amsterdam
const quiet = { error: () => undefined, warn: () => undefined };
const PHOTO = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#88aacc' } }).jpeg().toBuffer();
const PNG = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#cc8866' } }).png().toBuffer();

/** Fake Pexels and OpenAI images, with every request kept. */
function fakeApis() {
  const requests: Array<{ url: string; body?: unknown }> = [];
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: init?.body });
    if (url.startsWith('https://api.pexels.com/v1/search')) {
      const page = Number(new URL(url).searchParams.get('page'));
      return Response.json({
        photos: [1, 2, 3].map((n) => ({
          id: page * 10 + n,
          url: `https://www.pexels.com/photo/${page * 10 + n}/`,
          photographer: `Fotograaf ${page * 10 + n}`,
          photographer_url: 'https://www.pexels.com/@f',
          alt: 'strand',
          src: { large2x: `https://images.pexels.com/photos/${page * 10 + n}.jpeg` },
        })),
      });
    }
    if (url.startsWith('https://images.pexels.com/')) return new Response(new Uint8Array(PHOTO));
    if (url === 'https://api.openai.com/v1/images/generations' || url === 'https://api.openai.com/v1/images/edits') {
      return Response.json({ data: [{ b64_json: PNG.toString('base64') }] });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, requests, count: (prefix: string) => requests.filter((r) => r.url.startsWith(prefix)).length };
}

describe.skipIf(!adminUrl)('images for posts (integration)', { timeout: 30_000 }, () => {
  const t = useTestDatabase();
  const db = () => t.connection.db;
  const buffer = fakeBuffer();
  const apis = fakeApis();
  const dir = mkdtempSync(join(tmpdir(), 'hf-images-'));
  const media: MediaConfig = {
    dir,
    baseUrl: 'https://hyper-focus.invalid',
    pexelsApiKey: 'pexels-test-key',
    openai: { apiKey: 'openai-test-key', model: 'test-image-model', costCents: 10, fetchImpl: apis.fetchImpl },
    fetchImpl: apis.fetchImpl,
  };
  const content = { encryptionKey: ENCRYPTION_KEY, buffer: buffer.factory, media };
  const ctx = () => ({ db: db(), userId: t.userId, timezone: 'Europe/Amsterdam', now: NOW, content });
  const router = (claude?: ReturnType<typeof scriptedClaude>) => createAssistantRouter({ db: db(), claude: claude as never, now: () => NOW, log: quiet, content });
  const tap = (buttonId: string, claude?: ReturnType<typeof scriptedClaude>) => router(claude)({ kind: 'button', userId: t.userId, buttonId, title: '' });
  const post = async (id: number) => (await db().select().from(contentPosts).where(eq(contentPosts.id, id)))[0]!;
  let clientId = 0;
  let postId = 0;

  beforeAll(async () => {
    await db().update(users).set({ timezone: 'Europe/Amsterdam' }).where(eq(users.id, t.userId));
    await db().update(userSettings).set({ contentEnabled: true }).where(eq(userSettings.userId, t.userId));
    const logo = await storeImage(media, 'l', await sharp({ create: { width: 300, height: 300, channels: 4, background: '#e07a5f' } }).png().toBuffer());
    const [client] = await db()
      .insert(clients)
      .values({
        userId: t.userId,
        name: 'Studio Rust',
        socialsEnabled: true,
        bufferApiKeyEnc: encryptToken(GOOD_KEY, ENCRYPTION_KEY),
        imageSources: ['pexels', 'textcard'],
        imageStyle: 'rustig, natuurlijk licht',
        brandColors: ['#264653', '#f4f1de'],
        logoUrl: logo,
      })
      .returning({ id: clients.id });
    clientId = client!.id;
    await db().insert(clientChannels).values({ userId: t.userId, clientId, bufferChannelId: 'ch_ig', service: 'instagram', name: 'studiorust', days: [2], postTime: '10:00' });
    postId = (await draftPosts(ctx(), { clientId, text: 'Adem in. Adem uit. Nieuwe sessies vanaf dinsdag.' }))[0] ?? 0;
  });

  it('shows the sources that work for this client in the menu', async () => {
    const [menu] = await tap(`ci:${postId}:menu`);
    // No Drive folder on this card, so no "Uit mijn map".
    expect(menu?.choices?.map((c) => c.title)).toEqual(['Stockfoto (Pexels)', 'Meme', 'Tekstkaart', 'AI maken', 'Eigen foto', 'Beschrijf zelf', 'Zonder beeld']);
  });

  it('proposes a Pexels photo cut for Instagram, with the photographer, and pages through with "Ander beeld"', async () => {
    const [shown] = await tap(`ci:${postId}:pexels`);
    expect(shown?.photo).toMatch(/^https:\/\/hyper-focus\.invalid\/media\/p-[0-9a-f]{24}\.jpg$/);
    expect(shown?.text).toContain('Beeld: Foto: Fotograaf 11 via Pexels (https://www.pexels.com/photo/11/)');
    expect(shown?.buttons?.map((b) => b.title)).toEqual(['Goed', 'Aanpassen', 'Overslaan', 'Ander beeld', 'Beeld…']);
    const search = new URL(apis.requests.find((r) => r.url.startsWith('https://api.pexels.com'))!.url);
    expect(search.searchParams.get('orientation')).toBe('portrait');
    const file = shown!.photo!.split('/media/')[1]!;
    expect(await sharp(readFileSync(join(dir, file))).metadata()).toMatchObject({ width: 1080, height: 1350 });

    // The other two come from the same search; the fourth asks Pexels for the next page.
    await tap(`ci:${postId}:next`);
    const [third] = await tap(`ci:${postId}:next`);
    expect(third?.text).toContain('Fotograaf 13');
    expect(apis.count('https://api.pexels.com')).toBe(1);
    const [fourth] = await tap(`ci:${postId}:next`);
    expect(fourth?.text).toContain('Fotograaf 21');
    expect(apis.count('https://api.pexels.com')).toBe(2);
    expect((await post(postId)).mediaSource).toBe('pexels');
  });

  it('makes a text card in the client’s colours', async () => {
    const [shown] = await tap(`ci:${postId}:textcard`);
    expect(shown?.photo).toMatch(/\/media\/t-[0-9a-f]{24}\.jpg$/);
    expect(shown?.text).toContain('Beeld: Tekstkaart in je huisstijl');
    const file = shown!.photo!.split('/media/')[1]!;
    const { dominant } = await sharp(readFileSync(join(dir, file))).stats();
    // The background is the first brand colour, #264653.
    expect(Math.abs(dominant.r - 0x26) + Math.abs(dominant.g - 0x46) + Math.abs(dominant.b - 0x53)).toBeLessThan(40);
  });

  it('makes an AI image within the monthly budget, warns at 80% and stops at the cap', async () => {
    await db().update(userSettings).set({ aiImageBudgetCents: 25 }).where(eq(userSettings.userId, t.userId));
    const [first] = await tap(`ci:${postId}:ai`);
    expect(first?.photo).toMatch(/\/media\/a-[0-9a-f]{24}\.jpg$/);
    const generation = apis.requests.find((r) => r.url.endsWith('/images/generations'));
    expect(JSON.parse(String(generation?.body))).toMatchObject({ model: 'test-image-model', size: '1024x1536' });

    const second = await tap(`ci:${postId}:ai`);
    expect(second.at(-1)?.text).toBe('Je hebt nu 80% van je AI-budget voor deze maand gebruikt.');
    const third = await tap(`ci:${postId}:ai`);
    expect(third[0]?.text).toBe('Dat beeld lukte niet: Je AI-budget voor deze maand is op (€0.25). Je kunt het verhogen in Instellingen.');
    const spent = await db().select().from(contentPostImages).where(and(eq(contentPostImages.postId, postId), eq(contentPostImages.source, 'ai')));
    expect(spent.map((s) => s.costCents)).toEqual([10, 10]);
    await db().update(userSettings).set({ aiImageBudgetCents: 1000 }).where(eq(userSettings.userId, t.userId));
  });

  it('takes the user’s own photo after "Eigen foto", and edits it with AI when there is a caption', async () => {
    const [ask] = await tap(`ci:${postId}:upload`);
    expect(ask?.text).toContain('Stuur je foto');
    const [plain] = await router()({ kind: 'photo', userId: t.userId, image: PHOTO });
    expect(plain?.photo).toMatch(/\/media\/u-[0-9a-f]{24}\.jpg$/);
    expect(plain?.text).toContain('Beeld: Je eigen foto');

    // Without the menu, a photo goes to the newest waiting post; the caption is the instruction.
    const [edited] = await router()({ kind: 'photo', userId: t.userId, image: PHOTO, caption: 'zet ons logo rechtsonder' });
    expect(edited?.photo).toMatch(/\/media\/e-[0-9a-f]{24}\.jpg$/);
    expect(edited?.text).toContain('Beeld: Je foto, bewerkt met AI');
    const edit = apis.requests.find((r) => r.url.endsWith('/images/edits'));
    const form = edit?.body as FormData;
    expect(form.getAll('image[]')).toHaveLength(2); // the photo and the logo
    expect(String(form.get('prompt'))).toContain('zet ons logo rechtsonder');
    expect((await post(postId)).mediaSource).toBe('edit');
  });

  it('labels an AI-edited image when it goes to Buffer', async () => {
    const [reply] = await tap(`cp:${postId}:ok`);
    expect(reply?.text).toBe('Ingepland: dinsdag 13 okt 10:00 op studiorust.');
    expect(buffer.posts.at(-1)).toMatchObject({ channelId: 'ch_ig', aiGenerated: true });
    expect(buffer.posts.at(-1)?.imageUrl).toMatch(/\/media\/e-/);
  });

  it('turns an image wish into the post_image tool, never into a task or note', async () => {
    const [second] = await draftPosts(ctx(), { clientId, text: 'Maandag is ademdag.' });
    const before = { tasks: (await db().select().from(tasks)).length, ideas: (await db().select().from(ideas)).length };
    const claude = scriptedClaude([
      { tools: [{ name: 'post_image', input: { request: 'maak er een meme van over maandag', source: 'meme' } }] },
      { tools: [{ name: 'image_meme', input: { template: 'fine', top: 'Maandag', bottom: 'Ademdag' } }] },
    ]);
    const replies = await router(claude)({ kind: 'text', userId: t.userId, text: 'maak er een meme van over maandag' });
    expect(replies[0]?.photo).toBe('https://api.memegen.link/images/fine/Maandag/Ademdag.jpg');
    expect((await post(second!)).mediaSource).toBe('meme');
    // The router knew which post was waiting.
    expect(claude.callWithTools.mock.calls[0]?.[0].system).toContain(`post ${second} · Studio Rust · instagram: Maandag is ademdag.`);
    expect({ tasks: (await db().select().from(tasks)).length, ideas: (await db().select().from(ideas)).length }).toEqual(before);
  });

  it('goes without image on request, after which Instagram asks for one again', async () => {
    const [latest] = await db().select().from(contentPosts).where(eq(contentPosts.status, 'pending_approval')).orderBy(contentPosts.id);
    await tap(`ci:${latest!.id}:none`);
    expect((await post(latest!.id)).mediaUrl).toBeNull();
    const [blocked] = await tap(`cp:${latest!.id}:ok`);
    expect(blocked?.text).toBe('studiorust plaatst geen post zonder beeld. Kies eerst een beeld.');
  });

  it('starts a post from a photo with "post voor …:" as caption', async () => {
    const claude = scriptedClaude([{ tools: [{ name: 'draft_post', input: { client_name: 'Studio Rust', text: 'Zo ziet de nieuwe studio eruit.' } }] }]);
    const replies = await router(claude)({ kind: 'photo', userId: t.userId, image: PHOTO, caption: 'post voor Studio Rust: Zo ziet de nieuwe studio eruit.' });
    expect(replies[0]?.photo).toMatch(/\/media\/u-/);
    expect(replies[0]?.text).toContain('Zo ziet de nieuwe studio eruit.');
  });
});

describe('which source the words point to', () => {
  const all = ['drive', 'pexels', 'meme', 'textcard', 'ai'] as const;
  it('reads the source from the wish, else takes the client’s first', () => {
    expect(sourceFromWords('maak er een meme van', [...all], ['drive'])).toBe('meme');
    expect(sourceFromWords('zoek op pexels: strand', [...all], ['drive'])).toBe('pexels');
    expect(sourceFromWords('AI: rustige ochtend met koffie', [...all], ['drive'])).toBe('ai');
    expect(sourceFromWords('een tekstkaart graag', [...all], ['drive'])).toBe('textcard');
    expect(sourceFromWords('iets met water', [...all], ['pexels'])).toBe('pexels');
    // A source that is not available is not used.
    expect(sourceFromWords('maak er een meme van', ['pexels'], ['pexels'])).toBeUndefined();
  });
});
