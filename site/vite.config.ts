// The website (fase 2b): static pages, built to dist/site and served by hyperfocus-web on
// hyper-focus.pro. No JavaScript framework: plain HTML with Tailwind, so it loads fast.
import tailwindcss from '@tailwindcss/vite';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

/** "Waarom ik dit bouw" appears only once Elmer's text is in site/content/verhaal.html. */
function story(): Plugin {
  const file = `${root}content/verhaal.html`;
  return {
    name: 'hf-story',
    transformIndexHtml: (html) => html.replace('<!-- verhaal -->', existsSync(file) ? readFileSync(file, 'utf8') : ''),
  };
}

export default defineConfig({
  root,
  plugins: [tailwindcss(), story()],
  build: {
    outDir: fileURLToPath(new URL('../dist/site', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(['index', '404', 'wachtlijst-bijna', 'wachtlijst-bevestigd', 'wachtlijst-fout'].map((name) => [name, `${root}${name}.html`])),
    },
  },
  server: { proxy: { '/app': 'http://localhost:3999' } },
});
