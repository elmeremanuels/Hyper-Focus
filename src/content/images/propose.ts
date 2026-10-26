// Image proposals for a post (step C4): from the client's Drive folder, Pexels, a meme, a text
// card, AI, or the user's own photo (optionally edited by AI). Every proposal is kept in
// content_post_images; the chosen one is also on the post, so Buffer and cleanup find it.
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { fillPrompt, loadPrompt } from '../../ai/prompts.js';
import { getProfile } from '../../core/profile.js';
import { getSettings } from '../../core/settings.js';
import { clientChannels, clients, contentPostImages, contentPosts } from '../../db/schema/index.js';
import { listFolderImages, parseFolderId } from '../../integrations/drive/folder.js';
import { editImage, generateImage, type ImageSize } from '../../integrations/openai/images.js';
import { searchPhotos, type Orientation } from '../../integrations/pexels/client.js';
import { localNow } from '../../lib/time.js';
import { serviceLabel } from '../../texts/content.nl.js';
import { driveIdFromUrl, fetchImage, FORMATS, MEME_TEMPLATES, memeUrl, readStored, storeDrivePhoto, storeImage, type MediaConfig } from '../media.js';
import type { ContentContext } from '../posts.js';
import { renderTextCard } from './textcard.js';

export const IMAGE_SOURCES = ['drive', 'pexels', 'meme', 'textcard', 'ai'] as const;
export type ImageSource = (typeof IMAGE_SOURCES)[number];
type StoredSource = ImageSource | 'upload' | 'edit';

export type ProposeResult = { ok: true; note?: string } | { ok: false; reason: string };

const BUDGET_WARNING = 0.8;

type PostRow = Awaited<ReturnType<typeof loadPost>>;

async function loadPost(ctx: ContentContext, postId: number) {
  const [row] = await ctx.db
    .select({
      post: contentPosts,
      service: clientChannels.service,
      client: {
        id: clients.id,
        name: clients.name,
        profile: clients.profile,
        folder: clients.photoFolderUrl,
        memes: clients.memesAllowed,
        style: clients.imageStyle,
        colors: clients.brandColors,
        logo: clients.logoUrl,
        sources: clients.imageSources,
      },
    })
    .from(contentPosts)
    .innerJoin(clientChannels, eq(clientChannels.id, contentPosts.channelId))
    .innerJoin(clients, eq(clients.id, contentPosts.clientId))
    .where(and(eq(contentPosts.userId, ctx.userId), eq(contentPosts.id, postId)));
  return row;
}

const media = (ctx: ContentContext): MediaConfig | undefined => ctx.content?.media;

/** The sources that can work for this client now: keys present, memes allowed, a folder set. */
export function availableSources(config: MediaConfig | undefined, client: { folder: string | null; memes: boolean }): ImageSource[] {
  if (!config) return [];
  return IMAGE_SOURCES.filter((source) => {
    if (source === 'drive') return Boolean(config.googleApiKey && client.folder && parseFolderId(client.folder));
    if (source === 'pexels') return Boolean(config.pexelsApiKey);
    if (source === 'meme') return client.memes;
    if (source === 'ai') return Boolean(config.openai);
    return true;
  });
}

const orientation = (service: string): Orientation | undefined => {
  const format = FORMATS[service];
  if (!format) return undefined;
  return format.height > format.width ? 'portrait' : 'landscape';
};
const aiSize = (service: string): ImageSize => {
  const o = orientation(service);
  return o === 'portrait' ? '1024x1536' : o === 'landscape' ? '1536x1024' : '1024x1024';
};

/** Makes the chosen proposal the post's image, and every other one not chosen. */
async function choose(ctx: ContentContext, postId: number, imageId: number, url: string | null, source: StoredSource) {
  await ctx.db.update(contentPostImages).set({ chosen: false }).where(eq(contentPostImages.postId, postId));
  await ctx.db.update(contentPostImages).set({ chosen: true, shown: true, url }).where(eq(contentPostImages.id, imageId));
  await ctx.db
    .update(contentPosts)
    .set({ mediaUrl: url, mediaSource: url ? source : 'none' })
    .where(and(eq(contentPosts.userId, ctx.userId), eq(contentPosts.id, postId)));
}

async function addProposal(ctx: ContentContext, postId: number, values: Partial<typeof contentPostImages.$inferInsert> & { source: StoredSource }) {
  const [row] = await ctx.db
    .insert(contentPostImages)
    .values({ userId: ctx.userId, postId, ...values })
    .returning({ id: contentPostImages.id });
  return row?.id ?? 0;
}

// ---------------------------------------------------------------------------
// Claude: the brief per source

const BRIEFS = {
  drive: {
    description: 'De nummers van de foto’s die het best passen, beste eerst (hooguit 3).',
    schema: z.object({ photos: z.array(z.number().int().min(1)).max(3) }),
    properties: { photos: { type: 'array', items: { type: 'integer' } } },
  },
  pexels: {
    description: 'Een zoekterm in het Engels, 2 tot 5 woorden, voor een passende stockfoto.',
    schema: z.object({ query: z.string().min(2).max(80) }),
    properties: { query: { type: 'string' } },
  },
  meme: {
    description: 'Een meme: een sjabloon uit de lijst, korte tekst boven en onder.',
    schema: z.object({ template: z.string().max(40), top: z.string().max(100), bottom: z.string().max(100) }),
    properties: { template: { type: 'string' }, top: { type: 'string' }, bottom: { type: 'string' } },
  },
  textcard: {
    description: 'Eén korte, sterke zin uit of over de post voor een tekstkaart, hooguit 120 tekens, in de taal van de post.',
    schema: z.object({ text: z.string().min(3).max(140) }),
    properties: { text: { type: 'string' } },
  },
  ai: {
    description: 'Een beschrijving in het Engels voor een beeldgenerator: onderwerp, compositie, licht, sfeer, stijl. Geen tekst of letters in het beeld.',
    schema: z.object({ prompt: z.string().min(10).max(1500) }),
    properties: { prompt: { type: 'string' } },
  },
} as const;

async function brief<K extends keyof typeof BRIEFS>(ctx: ContentContext, row: NonNullable<PostRow>, kind: K, extra: string, hint?: string): Promise<z.infer<(typeof BRIEFS)[K]['schema']> | undefined> {
  if (!ctx.claude) return undefined;
  const def = BRIEFS[kind];
  const tool = `image_${kind}`;
  const profile = await getProfile(ctx.db, ctx.userId);
  const system = fillPrompt(loadPrompt('beeld'), {
    naam: profile?.name ?? 'de gebruiker',
    klant: row.client.name,
    kanaal: serviceLabel(row.service),
    profiel: row.client.profile.map((f) => `- ${f.label}: ${f.value}`).join('\n') || '(niets ingevuld)',
    stijl: row.client.style ?? '(geen)',
    tool,
  });
  const content = [`Post:\n${row.post.text}`, extra, hint ? `Wens van de gebruiker: ${hint}` : ''].filter(Boolean).join('\n\n');
  try {
    const result = await ctx.claude.callWithTools({
      userId: ctx.userId,
      purpose: `image_${kind}`,
      tier: 'fast',
      system,
      messages: [{ role: 'user', content }],
      tools: [{ name: tool, description: def.description, input_schema: { type: 'object', properties: def.properties, required: Object.keys(def.properties) } }],
      forceTool: tool,
      maxTokens: 1024,
    });
    const parsed = def.schema.safeParse(result.toolCalls[0]?.input);
    return parsed.success ? (parsed.data as z.infer<(typeof BRIEFS)[K]['schema']>) : undefined;
  } catch (error) {
    console.error(`Image brief ${kind} failed:`, error);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Sources

async function proposeDrive(ctx: ContentContext, row: NonNullable<PostRow>, config: MediaConfig, hint?: string): Promise<ProposeResult> {
  const folderId = row.client.folder ? parseFolderId(row.client.folder) : undefined;
  if (!config.googleApiKey || !folderId) return { ok: false, reason: 'Er is geen fotomap gekoppeld op de klantkaart.' };
  const all = await listFolderImages(folderId, config.googleApiKey, config.fetchImpl);
  // Not the photos of the last two weeks, nor the ones already proposed for this post.
  const recent = await ctx.db
    .select({ url: contentPosts.mediaUrl })
    .from(contentPosts)
    .where(and(eq(contentPosts.clientId, row.client.id), gte(contentPosts.createdAt, new Date(ctx.now.getTime() - 14 * 86_400_000))));
  const tried = await ctx.db.select({ sourceUrl: contentPostImages.sourceUrl }).from(contentPostImages).where(and(eq(contentPostImages.postId, row.post.id), eq(contentPostImages.source, 'drive')));
  const used = new Set([...recent.map((r) => driveIdFromUrl(r.url)), ...tried.map((t) => t.sourceUrl)].filter(Boolean));
  const fresh = all.filter((p) => !used.has(p.id));
  if (fresh.length === 0) return { ok: false, reason: 'In de fotomap staan geen foto’s meer die nog niet gebruikt zijn.' };
  const list = fresh.slice(0, 60);
  const picked = await brief(ctx, row, 'drive', `Foto's in de map:\n${list.map((p, i) => `${i + 1}. ${p.name}${p.description ? ` — ${p.description}` : ''}`).join('\n')}`, hint);
  const order = (picked?.photos ?? [1, 2, 3]).map((n) => list[n - 1]).filter((p): p is NonNullable<typeof p> => Boolean(p));
  const candidates = order.length ? order : list.slice(0, 3);
  let first = 0;
  for (const photo of candidates) {
    const id = await addProposal(ctx, row.post.id, { source: 'drive', sourceUrl: photo.id, prompt: hint ?? null, credit: `Foto uit je map: ${photo.name}` });
    if (!first) first = id;
  }
  return materialize(ctx, row, first);
}

async function proposePexels(ctx: ContentContext, row: NonNullable<PostRow>, config: MediaConfig, hint?: string): Promise<ProposeResult> {
  if (!config.pexelsApiKey) return { ok: false, reason: 'Pexels staat nog niet aan (PEXELS_API_KEY).' };
  const query = (await brief(ctx, row, 'pexels', '', hint))?.query ?? hint ?? row.post.text.split(/\s+/).slice(0, 4).join(' ');
  // A second round for the same query asks Pexels for the next page.
  const rounds = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(contentPostImages)
    .where(and(eq(contentPostImages.postId, row.post.id), eq(contentPostImages.source, 'pexels'), eq(contentPostImages.prompt, query)));
  const page = Math.floor((rounds[0]?.n ?? 0) / 3) + 1;
  const photos = await searchPhotos(query, config.pexelsApiKey, { orientation: orientation(row.service), perPage: 3, page }, config.fetchImpl);
  if (photos.length === 0) return { ok: false, reason: `Pexels vond niets voor "${query}". Beschrijf wat je zoekt, dan zoek ik opnieuw.` };
  let first = 0;
  for (const photo of photos) {
    const id = await addProposal(ctx, row.post.id, { source: 'pexels', sourceUrl: photo.downloadUrl, prompt: query, credit: `Foto: ${photo.photographer} via Pexels`, creditUrl: photo.pageUrl });
    if (!first) first = id;
  }
  return materialize(ctx, row, first);
}

async function proposeMeme(ctx: ContentContext, row: NonNullable<PostRow>, hint?: string): Promise<ProposeResult> {
  if (!row.client.memes) return { ok: false, reason: 'Memes staan uit op de klantkaart.' };
  const templates = Object.entries(MEME_TEMPLATES).map(([key, use]) => `- ${key}: ${use}`).join('\n');
  const meme = await brief(ctx, row, 'meme', `Sjablonen:\n${templates}`, hint);
  const url = meme ? memeUrl(meme.template, meme.top, meme.bottom) : undefined;
  if (!url) return { ok: false, reason: 'Er kwam geen bruikbare meme uit. Beschrijf wat je wilt, dan probeer ik het opnieuw.' };
  const id = await addProposal(ctx, row.post.id, { source: 'meme', url, prompt: hint ?? null, credit: 'Meme via memegen.link' });
  await choose(ctx, row.post.id, id, url, 'meme');
  return { ok: true };
}

async function proposeTextcard(ctx: ContentContext, row: NonNullable<PostRow>, config: MediaConfig, hint?: string): Promise<ProposeResult> {
  const line = (await brief(ctx, row, 'textcard', '', hint))?.text ?? firstSentence(row.post.text);
  const format = FORMATS[row.service] ?? { width: 1080, height: 1080 };
  const logo = row.client.logo ? await readStored(config, row.client.logo) : undefined;
  const png = await renderTextCard({ text: line, colors: row.client.colors, logo, width: format.width, height: format.height });
  const url = await storeImage(config, 't', png, row.service);
  const id = await addProposal(ctx, row.post.id, { source: 'textcard', url, prompt: line, credit: 'Tekstkaart in je huisstijl' });
  await choose(ctx, row.post.id, id, url, 'textcard');
  return { ok: true };
}

const firstSentence = (text: string) => {
  const sentence = /^[^.!?\n]{3,120}[.!?]?/.exec(text.trim())?.[0] ?? text.trim().slice(0, 110);
  return sentence.trim();
};

/** Spent on AI images this calendar month (local), in cents. */
export async function aiSpentThisMonth(ctx: ContentContext): Promise<number> {
  const monthStart = localNow(ctx.timezone, ctx.now).startOf('month').toJSDate();
  const [row] = await ctx.db
    .select({ cents: sql<number>`coalesce(sum(${contentPostImages.costCents}), 0)::int` })
    .from(contentPostImages)
    .where(and(eq(contentPostImages.userId, ctx.userId), inArray(contentPostImages.source, ['ai', 'edit']), gte(contentPostImages.createdAt, monthStart)));
  return row?.cents ?? 0;
}

/** Checks the monthly budget before an AI image; a note when 80% is passed. */
async function aiBudget(ctx: ContentContext, cost: number): Promise<{ ok: true; note?: string } | { ok: false; reason: string }> {
  const { aiImageBudgetCents: budget } = await getSettings(ctx.db, ctx.userId);
  const spent = await aiSpentThisMonth(ctx);
  if (spent + cost > budget) return { ok: false, reason: `Je AI-budget voor deze maand is op (€${(budget / 100).toFixed(2)}). Je kunt het verhogen in Instellingen.` };
  const after = spent + cost;
  if (after >= budget * BUDGET_WARNING && spent < budget * BUDGET_WARNING) {
    return { ok: true, note: `Je hebt nu ${Math.round((after / budget) * 100)}% van je AI-budget voor deze maand gebruikt.` };
  }
  return { ok: true };
}

async function proposeAi(ctx: ContentContext, row: NonNullable<PostRow>, config: MediaConfig, hint?: string): Promise<ProposeResult> {
  if (!config.openai) return { ok: false, reason: 'AI-beelden staan nog niet aan (OPENAI_IMAGE_MODEL).' };
  const budget = await aiBudget(ctx, config.openai.costCents);
  if (!budget.ok) return budget;
  const style = row.client.style ? ` Style: ${row.client.style}.` : '';
  const prompt = (await brief(ctx, row, 'ai', '', hint))?.prompt ?? `${hint ?? row.post.text.slice(0, 300)}.${style} No text in the image.`;
  const png = await generateImage(config.openai, prompt, aiSize(row.service));
  const url = await storeImage(config, 'a', png, row.service);
  const id = await addProposal(ctx, row.post.id, { source: 'ai', url, prompt, costCents: config.openai.costCents, credit: 'AI-beeld' });
  await choose(ctx, row.post.id, id, url, 'ai');
  return budget.note ? { ok: true, note: budget.note } : { ok: true };
}

/** Downloads (and cuts) a stored candidate from Drive or Pexels, then chooses it. */
async function materialize(ctx: ContentContext, row: NonNullable<PostRow>, imageId: number): Promise<ProposeResult> {
  const config = media(ctx);
  const [image] = await ctx.db.select().from(contentPostImages).where(eq(contentPostImages.id, imageId));
  if (!config || !image) return { ok: false, reason: 'Dit beeld is er niet meer.' };
  let url = image.url;
  if (!url && image.sourceUrl) {
    url =
      image.source === 'drive'
        ? await storeDrivePhoto(config, image.sourceUrl, row.service)
        : await storeImage(config, 'p', await fetchImage(image.sourceUrl, config.fetchImpl), row.service);
  }
  await choose(ctx, row.post.id, image.id, url, image.source as StoredSource);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The public actions

/** A proposal from one source; `hint` is the user's own words ("strand bij zonsondergang"). */
export async function proposeImage(ctx: ContentContext, postId: number, source: ImageSource, hint?: string): Promise<ProposeResult> {
  const row = await loadPost(ctx, postId);
  const config = media(ctx);
  if (!row) return { ok: false, reason: 'Deze post bestaat niet meer.' };
  if (!config) return { ok: false, reason: 'Beelden staan niet aan op de server (APP_BASE_URL).' };
  try {
    switch (source) {
      case 'drive':
        return await proposeDrive(ctx, row, config, hint);
      case 'pexels':
        return await proposePexels(ctx, row, config, hint);
      case 'meme':
        return await proposeMeme(ctx, row, hint);
      case 'textcard':
        return await proposeTextcard(ctx, row, config, hint);
      case 'ai':
        return await proposeAi(ctx, row, config, hint);
    }
  } catch (error) {
    console.error(`Image proposal ${source} for post ${postId} failed:`, error);
    return { ok: false, reason: error instanceof Error ? error.message : 'Het beeld lukte niet.' };
  }
}

/** "Ander voorstel": the next candidate of the same source, else a new round of it. */
export async function nextImage(ctx: ContentContext, postId: number): Promise<ProposeResult> {
  const row = await loadPost(ctx, postId);
  if (!row) return { ok: false, reason: 'Deze post bestaat niet meer.' };
  const [current] = await ctx.db
    .select()
    .from(contentPostImages)
    .where(and(eq(contentPostImages.postId, postId), eq(contentPostImages.chosen, true)));
  const source = (current?.source ?? row.client.sources[0] ?? 'textcard') as StoredSource;
  if (source === 'upload' || source === 'edit') return autoPropose(ctx, postId);
  const [waiting] = await ctx.db
    .select({ id: contentPostImages.id })
    .from(contentPostImages)
    .where(and(eq(contentPostImages.postId, postId), eq(contentPostImages.source, source), eq(contentPostImages.shown, false)))
    .orderBy(asc(contentPostImages.id))
    .limit(1);
  if (waiting) {
    try {
      return await materialize(ctx, row, waiting.id);
    } catch (error) {
      console.error(`Next image for post ${postId} failed:`, error);
    }
  }
  // A new round. Pexels keeps its search term (the next page); the others start fresh.
  return proposeImage(ctx, postId, source as ImageSource, source === 'pexels' ? (current?.prompt ?? undefined) : undefined);
}

/** The first source in the client's order that gives an image; AI only when the client lists it. */
export async function autoPropose(ctx: ContentContext, postId: number): Promise<ProposeResult> {
  const row = await loadPost(ctx, postId);
  if (!row) return { ok: false, reason: 'Deze post bestaat niet meer.' };
  const available = availableSources(media(ctx), row.client);
  const order = row.client.sources.filter((s): s is ImageSource => (IMAGE_SOURCES as readonly string[]).includes(s) && available.includes(s as ImageSource));
  for (const source of order) {
    const result = await proposeImage(ctx, postId, source);
    if (result.ok) return result;
  }
  return { ok: false, reason: 'Er kwam geen beeld uit de gekozen bronnen.' };
}

/** "Zonder beeld". */
export async function removeImage(ctx: ContentContext, postId: number): Promise<void> {
  await ctx.db.update(contentPostImages).set({ chosen: false }).where(eq(contentPostImages.postId, postId));
  await ctx.db.update(contentPosts).set({ mediaUrl: null, mediaSource: 'none' }).where(and(eq(contentPosts.userId, ctx.userId), eq(contentPosts.id, postId)));
}

/**
 * The user's own photo. With an instruction ("logo rechtsonder", "maak hem lichter") AI edits
 * it; the client's logo goes along when the instruction mentions it.
 */
export async function attachPhoto(ctx: ContentContext, postId: number, bytes: Buffer, instruction?: string): Promise<ProposeResult> {
  const row = await loadPost(ctx, postId);
  const config = media(ctx);
  if (!row) return { ok: false, reason: 'Deze post bestaat niet meer.' };
  if (!config) return { ok: false, reason: 'Beelden staan niet aan op de server (APP_BASE_URL).' };
  try {
    const original = await storeImage(config, 'u', bytes, row.service);
    const upload = await addProposal(ctx, postId, { source: 'upload', url: original, credit: 'Je eigen foto' });
    if (!instruction?.trim()) {
      await choose(ctx, postId, upload, original, 'upload');
      return { ok: true };
    }
    if (!config.openai) {
      await choose(ctx, postId, upload, original, 'upload');
      return { ok: true, note: 'AI-bewerking staat nog niet aan, dus ik gebruik je foto zoals hij is.' };
    }
    const budget = await aiBudget(ctx, config.openai.costCents);
    if (!budget.ok) {
      await choose(ctx, postId, upload, original, 'upload');
      return { ok: true, note: `${budget.reason} Ik gebruik je foto zoals hij is.` };
    }
    const images = [{ bytes: (await readStored(config, original)) ?? bytes, mimeType: 'image/jpeg', name: 'foto.jpg' }];
    const logo = /logo/i.test(instruction) && row.client.logo ? await readStored(config, row.client.logo) : undefined;
    if (logo) images.push({ bytes: logo, mimeType: 'image/jpeg', name: 'logo.jpg' });
    const prompt = `${instruction.trim()}${logo ? ' The second image is the logo to use.' : ''} Keep the photo realistic and keep its subject.`;
    const edited = await editImage(config.openai, images, prompt, aiSize(row.service));
    const url = await storeImage(config, 'e', edited, row.service);
    const id = await addProposal(ctx, postId, { source: 'edit', url, prompt: instruction.trim(), costCents: config.openai.costCents, credit: 'Je foto, bewerkt met AI' });
    await choose(ctx, postId, id, url, 'edit');
    return budget.note ? { ok: true, note: budget.note } : { ok: true };
  } catch (error) {
    console.error(`Photo for post ${postId} failed:`, error);
    return { ok: false, reason: error instanceof Error ? error.message : 'De foto lukte niet.' };
  }
}

/** The chosen proposal, for the line under the image ("Foto: Ana via Pexels"). */
export async function chosenImage(ctx: Pick<ContentContext, 'db'>, postId: number) {
  const [row] = await ctx.db
    .select({ source: contentPostImages.source, credit: contentPostImages.credit, creditUrl: contentPostImages.creditUrl })
    .from(contentPostImages)
    .where(and(eq(contentPostImages.postId, postId), eq(contentPostImages.chosen, true)))
    .orderBy(desc(contentPostImages.id))
    .limit(1);
  return row;
}

/** Records an image the planner already picked (C3), so the menu and cleanup know it. */
export async function recordChosen(ctx: ContentContext, postId: number, url: string, source: StoredSource, credit: string, sourceUrl?: string): Promise<void> {
  const id = await addProposal(ctx, postId, { source, url, credit, sourceUrl: sourceUrl ?? null });
  await choose(ctx, postId, id, url, source);
}
