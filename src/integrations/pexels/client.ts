// Pexels stock photos (step C4): search by a short English query, download the chosen one.
// Free API key (PEXELS_API_KEY); 200 requests an hour. The photographer is credited in the app.

const API = 'https://api.pexels.com/v1/search';

export type Orientation = 'portrait' | 'landscape' | 'square';

export interface PexelsPhoto {
  id: number;
  pageUrl: string;
  photographer: string;
  photographerUrl: string;
  alt: string;
  /** About 1880 px wide: enough for every network, small enough to download fast. */
  downloadUrl: string;
}

export async function searchPhotos(query: string, apiKey: string, options: { orientation?: Orientation | undefined; perPage?: number; page?: number } = {}, fetchImpl: typeof fetch = fetch): Promise<PexelsPhoto[]> {
  const params = new URLSearchParams({ query, per_page: String(options.perPage ?? 3), page: String(options.page ?? 1), locale: 'nl-NL' });
  if (options.orientation) params.set('orientation', options.orientation);
  const response = await fetchImpl(`${API}?${params}`, { headers: { authorization: apiKey } });
  if (response.status === 429) throw new Error('Pexels: te veel zoekopdrachten dit uur');
  if (!response.ok) throw new Error(`Pexels gaf HTTP ${response.status}`);
  const body = (await response.json()) as {
    photos?: Array<{ id: number; url: string; photographer: string; photographer_url: string; alt?: string; src: { large2x: string } }>;
  };
  return (body.photos ?? []).map((p) => ({
    id: p.id,
    pageUrl: p.url,
    photographer: p.photographer,
    photographerUrl: p.photographer_url,
    alt: p.alt ?? '',
    downloadUrl: p.src.large2x,
  }));
}
