// Images for posts (step C3): photos from the client's Drive folder, stored under MEDIA_DIR and
// served at /media/…, and memes from memegen.link. Photos of sent posts go after the week.
import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, eq, inArray, isNotNull, like, lt } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { contentPosts, users } from '../db/schema/index.js';
import { downloadImage, IMAGE_TYPES } from '../integrations/drive/folder.js';
import { localNow } from '../lib/time.js';

export interface MediaConfig {
  /** Where downloaded photos live on disk. */
  dir: string;
  /** APP_BASE_URL: photos are served at <base>/media/<file>. */
  baseUrl: string;
  /** GOOGLE_API_KEY, read-only, for public Drive folders. */
  googleApiKey?: string | undefined;
  fetchImpl?: typeof fetch;
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

/** Downloads a Drive photo, stores it under an unguessable name and returns its public URL. */
export async function storeDrivePhoto(config: MediaConfig, fileId: string): Promise<string> {
  if (!config.googleApiKey) throw new Error('GOOGLE_API_KEY ontbreekt');
  const { bytes, mimeType } = await downloadImage(fileId, config.googleApiKey, config.fetchImpl);
  // The Drive id is in the name, so a photo is not picked twice in a row.
  const file = `d-${fileId.replace(/[^\w-]/g, '')}-${randomBytes(12).toString('hex')}.${IMAGE_TYPES[mimeType]}`;
  await mkdir(config.dir, { recursive: true });
  await writeFile(join(config.dir, file), bytes);
  return new URL(`/media/${file}`, config.baseUrl).toString();
}

/** Removes a stored photo; a file that is already gone is fine. */
async function removeFile(dir: string, url: string | null): Promise<boolean> {
  const file = url?.split('/media/')[1];
  if (!file || !/^d-[\w.-]+$/.test(file)) return false;
  await unlink(join(dir, file)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
  return true;
}

/** All photos of one user, when their account is deleted. */
export async function deleteUserMedia(db: Database, userId: number, dir: string): Promise<void> {
  const rows = await db.select({ mediaUrl: contentPosts.mediaUrl }).from(contentPosts).where(and(eq(contentPosts.userId, userId), isNotNull(contentPosts.mediaUrl)));
  for (const row of rows) await removeFile(dir, row.mediaUrl);
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
    .where(and(inArray(contentPosts.status, ['sent', 'skipped']), isNotNull(contentPosts.mediaUrl), like(contentPosts.mediaUrl, '%/media/d-%'), lt(contentPosts.updatedAt, now)));
  let removed = 0;
  for (const row of rows) {
    const weekStart = localNow(row.timezone, now).startOf('week').toJSDate();
    const moment = row.dueAt ?? row.updatedAt;
    if (moment >= weekStart) continue;
    if (await removeFile(config.dir, row.mediaUrl)) removed++;
    await db.update(contentPosts).set({ mediaUrl: null }).where(eq(contentPosts.id, row.id));
  }
  return removed;
}
