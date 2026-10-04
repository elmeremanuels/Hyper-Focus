// The website (fase 2b): static pages, built to dist/site and served by hyperfocus-web on
// hyper-focus.pro. No JavaScript framework: plain HTML with Tailwind, so it loads fast.
import tailwindcss from '@tailwindcss/vite';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

/** Reads a partial from site/content, or '' when the file is not there. */
const partial = (name: string) => {
  const file = `${root}content/${name}`;
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
};

/**
 * Build-time blocks: "Waarom ik dit bouw" from content/verhaal.html (plain <h2> and <p>; the
 * section gives it the site's style), and the company line for the privacy block from
 * content/bedrijf.local.html, which only exists on the server (git-ignored).
 */
function partials(): Plugin {
  return {
    name: 'hf-partials',
    transformIndexHtml(html) {
      const story = partial('verhaal.html');
      return html
        .replace('<!-- verhaal -->', story ? `<section id="verhaal" class="story mx-auto max-w-3xl px-4 py-16">${story}</section>` : '')
        .replace('<!-- bedrijf -->', partial('bedrijf.local.html'));
    },
  };
}

export default defineConfig({
  root,
  plugins: [tailwindcss(), partials()],
  build: {
    outDir: fileURLToPath(new URL('../dist/site', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(['index', '404', 'wachtlijst-bijna', 'wachtlijst-bevestigd', 'wachtlijst-fout'].map((name) => [name, `${root}${name}.html`])),
    },
  },
  server: { proxy: { '/app': 'http://localhost:3999' } },
});
