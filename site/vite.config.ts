// The website (fase 2b): static pages, built to dist/site and served by hyperfocus-web on
// hyper-focus.pro. No JavaScript framework: plain HTML with Tailwind, so it loads fast.
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  plugins: [tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL('../dist/site', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: { input: { index: `${root}index.html`, notFound: `${root}404.html` } },
  },
  server: { proxy: { '/app': 'http://localhost:3999' } },
});
