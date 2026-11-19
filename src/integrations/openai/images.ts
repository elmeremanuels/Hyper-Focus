// OpenAI image generation and editing (step C4). The model comes from OPENAI_IMAGE_MODEL and is
// never hard-coded; without it AI images are off. Images come back as base64 PNG.

const API = 'https://api.openai.com/v1/images';

export type ImageSize = '1024x1024' | '1024x1536' | '1536x1024';

export interface ImageConfig {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

interface ImagesResponse {
  data?: Array<{ b64_json?: string }>;
  error?: { message?: string };
}

async function read(response: Response): Promise<Buffer> {
  const body = (await response.json().catch(() => ({}))) as ImagesResponse;
  if (!response.ok) throw new Error(`OpenAI-beeld: ${body.error?.message ?? `HTTP ${response.status}`}`);
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI-beeld gaf geen afbeelding terug');
  return Buffer.from(b64, 'base64');
}

/** A new image from a description. */
export async function generateImage(config: ImageConfig, prompt: string, size: ImageSize): Promise<Buffer> {
  const response = await (config.fetchImpl ?? fetch)(`${API}/generations`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: config.model, prompt, size, n: 1, quality: 'medium' }),
  });
  return read(response);
}

/** Edits the first image with the instruction; further images (such as a logo) are references. */
export async function editImage(config: ImageConfig, images: Array<{ bytes: Buffer; mimeType: string; name: string }>, prompt: string, size: ImageSize): Promise<Buffer> {
  const form = new FormData();
  form.append('model', config.model);
  form.append('prompt', prompt);
  form.append('size', size);
  form.append('n', '1');
  for (const image of images) form.append('image[]', new Blob([new Uint8Array(image.bytes)], { type: image.mimeType }), image.name);
  const response = await (config.fetchImpl ?? fetch)(`${API}/edits`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.apiKey}` },
    body: form,
  });
  return read(response);
}
