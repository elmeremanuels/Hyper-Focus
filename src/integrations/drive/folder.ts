// A public Google Drive folder with photos (step C3): list the images and download one.
// Read-only with an API key (GOOGLE_API_KEY on the VPS); the folder must be shared by link.

const API = 'https://www.googleapis.com/drive/v3/files';
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

export interface DriveImage {
  id: string;
  name: string;
  description: string | null;
}

/** The folder id from a share link: …/drive/folders/<id>?usp=sharing, or ?id=<id>. */
export function parseFolderId(url: string): string | undefined {
  const match = /\/folders\/([\w-]{10,})/.exec(url) ?? /[?&]id=([\w-]{10,})/.exec(url);
  return match?.[1];
}

export async function listFolderImages(folderId: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<DriveImage[]> {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
    fields: 'files(id,name,description,mimeType,size)',
    orderBy: 'modifiedTime desc',
    pageSize: '100',
    key: apiKey,
  });
  const response = await fetchImpl(`${API}?${params}`);
  if (!response.ok) throw new Error(`Drive gaf HTTP ${response.status}`);
  const body = (await response.json()) as { files?: Array<{ id: string; name: string; description?: string; mimeType: string; size?: string }> };
  return (body.files ?? [])
    .filter((f) => IMAGE_TYPES[f.mimeType] && Number(f.size ?? 0) <= MAX_IMAGE_BYTES)
    .map((f) => ({ id: f.id, name: f.name, description: f.description ?? null }));
}

export async function downloadImage(fileId: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<{ bytes: Buffer; mimeType: string }> {
  const response = await fetchImpl(`${API}/${encodeURIComponent(fileId)}?alt=media&key=${encodeURIComponent(apiKey)}`);
  if (!response.ok) throw new Error(`Drive gaf HTTP ${response.status}`);
  const mimeType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
  if (!IMAGE_TYPES[mimeType]) throw new Error(`Geen afbeelding: ${mimeType}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Afbeelding is groter dan 8 MB');
  return { bytes, mimeType };
}
