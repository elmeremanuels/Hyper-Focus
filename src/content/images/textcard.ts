// Text cards (step C4): a short line from the post on a plain background in the client's colours,
// with the logo in a corner. Made here with sharp, without an AI image.
import sharp from 'sharp';

export const DEFAULT_COLORS = ['#1f3a34', '#f6f1e7'] as const;
const HEX = /^#[0-9a-f]{6}$/i;

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Splits text into lines of about `width` characters, at word boundaries. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.trim().split(/\s+/)) {
    if (line && (line + ' ' + word).length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** A PNG of the card; colours fall back to a calm default when the client has none. */
export async function renderTextCard(input: { text: string; colors?: string[]; logo?: Buffer | undefined; width: number; height: number }): Promise<Buffer> {
  const [bg, fg] = [input.colors?.[0], input.colors?.[1]].map((c, i) => (c && HEX.test(c) ? c : DEFAULT_COLORS[i]));
  const { width, height } = input;
  const margin = Math.round(width * 0.1);
  // Fewer words, bigger letters.
  const size = input.text.length < 60 ? Math.round(width * 0.075) : input.text.length < 120 ? Math.round(width * 0.06) : Math.round(width * 0.048);
  const lines = wrap(input.text, Math.max(10, Math.floor((width - 2 * margin) / (size * 0.55))));
  const lineHeight = Math.round(size * 1.3);
  const top = Math.round((height - lines.length * lineHeight) / 2 + size);
  const tspans = lines.map((l, i) => `<tspan x="${margin}" y="${top + i * lineHeight}">${escapeXml(l)}</tspan>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<rect width="100%" height="100%" fill="${bg}"/>
<rect x="${margin}" y="${top - size - Math.round(size * 0.9)}" width="${Math.round(size * 1.6)}" height="${Math.max(4, Math.round(size * 0.12))}" fill="${fg}"/>
<text font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="${size}" font-weight="700" fill="${fg}">${tspans}</text>
</svg>`;
  let card = sharp(Buffer.from(svg));
  if (input.logo) {
    const logoSize = Math.round(width * 0.14);
    const logo = await sharp(input.logo).resize(logoSize, logoSize, { fit: 'inside' }).png().toBuffer();
    // Bottom right, half a margin from the edges.
    const inset = Math.round(margin / 2);
    card = card.composite([{ input: logo, top: height - inset - logoSize, left: width - inset - logoSize }]);
  }
  return card.png().toBuffer();
}
