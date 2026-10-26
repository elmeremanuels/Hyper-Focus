// Images for posts (steps C3–C4): stored under MEDIA_DIR and served at /media/…, cut to the
// format of the channel. Memes come from memegen.link. Images go after the week of the post.
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import sharp from 'sharp';
import type { Database } from '../db/client.js';
import { clients, contentPostImages, contentPosts, users } from '../db/schema/index.js';
import { downloadImage } from '../integrations/drive/folder.js';
import type { ImageConfig } from '../integrations/openai/images.js';
import { localNow } from '../lib/time.js';

export interface MediaConfig {
  /** Where downloaded photos live on disk. */
  dir: string;
  /** APP_BASE_URL: photos are served at <base>/media/<file>. */
  baseUrl: string;
  /** GOOGLE_API_KEY, read-only, for public Drive folders. */
  googleApiKey?: string | undefined;
  /** PEXELS_API_KEY for stock photos (step C4). */
  pexelsApiKey?: string | undefined;
  /** OpenAI images (step C4); without it AI images are off. */
  openai?: (ImageConfig & { costCents: number }) | undefined;
  fetchImpl?: typeof fetch;
}

/** The format per network: portrait for Instagram and Threads, landscape for link feeds. */
export const FORMATS: Record<string, { width: number; height: number }> = {
  instagram: { width: 1080, height: 1350 },
  threads: { width: 1080, height: 1350 },
  facebook: { width: 1200, height: 630 },
  linkedin: { width: 1200, height: 627 },
  twitter: { width: 1200, height: 675 },
  bluesky: { width: 1200, height: 675 },
  mastodon: { width: 1200, height: 675 },
};

/** Our files: one letter for the source, then a name nobody can guess. */
const OUR_FILE = /^[a-z]-[\w.-]+$/;

/**
 * Stores an image as JPEG, cut to the network's format when there is one, and returns its URL.
 * The prefix names the source: d drive, p pexels, a ai, u upload, e edit, t text card, l logo.
 */
export async function storeImage(config: MediaConfig, prefix: string, bytes: Buffer, service?: string): Promise<string> {
  const format = service ? FORMATS[service] : undefined;
  let image = sharp(bytes, { failOn: 'error' }).rotate();
  if (format) image = image.resize(format.width, format.height, { fit: 'cover', position: 'attention' });
  else image = image.resize(2048, 2048, { fit: 'inside', withoutEnlargement: true });
  const out = await image.flatten({ background: '#ffffff' }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  const file = `${prefix}-${randomBytes(12).toString('hex')}.jpg`;
  await mkdir(config.dir, { recursive: true });
  await writeFile(join(config.dir, file), out);
  return new URL(`/media/${file}`, config.baseUrl).toString();
}

/** A client's logo: PNG with transparency, at most 1024 px. */
export async function storeLogo(config: MediaConfig, bytes: Buffer): Promise<string> {
  const out = await sharp(bytes, { failOn: 'error' }).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  const file = `l-${randomBytes(12).toString('hex')}.png`;
  await mkdir(config.dir, { recursive: true });
  await writeFile(join(config.dir, file), out);
  return new URL(`/media/${file}`, config.baseUrl).toString();
}

/** The bytes of one of our images, e.g. a photo to edit with AI. */
export async function readStored(config: MediaConfig, url: string): Promise<Buffer | undefined> {
  const file = url.split('/media/')[1];
  if (!file || !OUR_FILE.test(file)) return undefined;
  return readFile(join(config.dir, file)).catch(() => undefined);
}

/** Downloads an image from a URL (Pexels), at most 8 MB. */
export async function fetchImage(url: string, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Beeld ophalen gaf HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 8 * 1024 * 1024) throw new Error('Afbeelding is groter dan 8 MB');
  return bytes;
}

/** Well-known memegen.link templates, with what they are for. */
export const MEME_TEMPLATES: Record<string, string> = {
  drake: 'Drake: boven iets afwijzen, onder iets beters kiezen',
  db: 'Afgeleide vriend: boven het nieuwe, onder het oude',
  fine: 'This is fine: rustig blijven terwijl alles brandt',
  cmm: 'Change my mind: een stelling',
  rollsafe: 'Slim wijzen naar je hoofd: een handige (rare) oplossing',
  stonks: 'Stonks: een succesje',
  success: 'Success kid: een kleine overwinning',
  buzz: 'Overal X: iets wat je overal ziet',
  gru: 'Gru-plan: een plan dat op het laatst misgaat',
  ds: 'Twee knoppen: een lastige keuze',
  pigeon: 'Is dit een duif?: iets verkeerd benoemen',
  spongebob: 'Spottende SpongeBob: iets nadoen',
};

/** memegen.link escapes: https://memegen.link/#special-characters */
export function memeText(text: string): string {
  const escaped = text
    .trim()
    .replace(/_/g, '__')
    .replace(/-/g, '--')
    .replace(/ /g, '_')
    .replace(/\n/g, '~n')
    .replace(/\?/g, '~q')
    .replace(/&/g, '~a')
    .replace(/%/g, '~p')
    .replace(/#/g, '~h')
    .replace(/\//g, '~s')
    .replace(/\\/g, '~b')
    .replace(/</g, '~l')
    .replace(/>/g, '~g')
    .replace(/"/g, "''");
  return encodeURIComponent(escaped || '_').replace(/%7E/gi, '~').replace(/'/g, '%27');
}

export function memeUrl(template: string, top: string, bottom: string): string | undefined {
  if (!MEME_TEMPLATES[template]) return undefined;
  return `https://api.memegen.link/images/${template}/${memeText(top)}/${memeText(bottom)}.jpg`;
}

/** Downloads a Drive photo and stores it; the Drive id is in the name, so it is not picked twice in a row. */
export async function storeDrivePhoto(config: MediaConfig, fileId: string, service?: string): Promise<string> {
  if (!config.googleApiKey) throw new Error('GOOGLE_API_KEY ontbreekt');
  const { bytes } = await downloadImage(fileId, config.googleApiKey, config.fetchImpl);
  return storeImage(config, `d-${fileId.replace(/[^\w-]/g, '')}`, bytes, service);
}

/** Removes a stored image; a file that is already gone is fine. */
export async function removeFile(dir: string, url: string | null): Promise<boolean> {
  const file = url?.split('/media/')[1];
  if (!file || !OUR_FILE.test(file)) return false;
  await unlink(join(dir, file)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
  return true;
}

/** Every image of one user (posts, proposals, logos), when their account is deleted. */
export async function deleteUserMedia(db: Database, userId: number, dir: string): Promise<void> {
  const posts = await db.select({ url: contentPosts.mediaUrl }).from(contentPosts).where(and(eq(contentPosts.userId, userId), isNotNull(contentPosts.mediaUrl)));
  const proposals = await db.select({ url: contentPostImages.url }).from(contentPostImages).where(and(eq(contentPostImages.userId, userId), isNotNull(contentPostImages.url)));
  const logos = await db.select({ url: clients.logoUrl }).from(clients).where(and(eq(clients.userId, userId), isNotNull(clients.logoUrl)));
  for (const row of [...posts, ...proposals, ...logos]) await removeFile(dir, row.url);
}

/** The Drive id inside one of our photo URLs. */
export function driveIdFromUrl(url: string | null): string | undefined {
  return url ? /\/media\/d-([\w-]+)-[0-9a-f]{24}\.\w+$/.exec(url)?.[1] : undefined;
}

/**
 * After the week in which a post went out (or was skipped), its photo is deleted from disk.
 * Failed and waiting posts keep theirs. Returns the number of files removed.
 */
export async function cleanupWeekMedia(db: Database, config: MediaConfig, now: Date): Promise<number> {
  const rows = await db
    .select({ id: contentPosts.id, mediaUrl: contentPosts.mediaUrl, dueAt: contentPosts.dueAt, updatedAt: contentPosts.updatedAt, timezone: users.timezone })
    .from(contentPosts)
    .innerJoin(users, eq(users.id, contentPosts.userId))
    .where(inArray(contentPosts.status, ['sent', 'skipped']));
  let removed = 0;
  for (const row of rows) {
    const weekStart = localNow(row.timezone, now).startOf('week').toJSDate();
    const moment = row.dueAt ?? row.updatedAt;
    if (moment >= weekStart) continue;
    // The chosen image and every proposal that was not chosen (step C4).
    const proposals = await db.select({ id: contentPostImages.id, url: contentPostImages.url }).from(contentPostImages).where(eq(contentPostImages.postId, row.id));
    const urls = new Set([row.mediaUrl, ...proposals.map((p) => p.url)].filter((u): u is string => Boolean(u)));
    for (const url of urls) if (await removeFile(config.dir, url)) removed++;
    if (row.mediaUrl?.includes('/media/')) await db.update(contentPosts).set({ mediaUrl: null }).where(eq(contentPosts.id, row.id));
    if (proposals.length) await db.delete(contentPostImages).where(eq(contentPostImages.postId, row.id));
  }
  return removed;
}

/** The images of one client (posts, proposals and logo), when the client is deleted. */
export async function deleteClientMedia(db: Database, userId: number, clientId: number, dir: string): Promise<void> {
  const posts = await db
    .select({ id: contentPosts.id, url: contentPosts.mediaUrl })
    .from(contentPosts)
    .where(and(eq(contentPosts.userId, userId), eq(contentPosts.clientId, clientId)));
  const proposals = posts.length
    ? await db.select({ url: contentPostImages.url }).from(contentPostImages).where(inArray(contentPostImages.postId, posts.map((p) => p.id)))
    : [];
  const [client] = await db.select({ url: clients.logoUrl }).from(clients).where(and(eq(clients.userId, userId), eq(clients.id, clientId)));
  for (const row of [...posts, ...proposals, ...(client ? [client] : [])]) await removeFile(dir, row.url);
}
