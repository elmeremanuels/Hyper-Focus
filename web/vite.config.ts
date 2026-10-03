// The dashboard (fase 2a): React + Vite + Tailwind. Built to dist/web, served by hyperfocus-web
// on app.hyper-focus.pro. `npm run dev:web` proxies the API to the local server.
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  build: { outDir: fileURLToPath(new URL('../dist/web', import.meta.url)), emptyOutDir: true },
  server: {
    proxy: { '/api': 'http://localhost:3999', '/auth': 'http://localhost:3999', '/login': 'http://localhost:3999', '/app': 'http://localhost:3999' },
  },
});
