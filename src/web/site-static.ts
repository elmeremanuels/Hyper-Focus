// Serves the website (dist/site) on the main host only, e.g. hyper-focus.pro. Mounted last: the
// server's own paths (webhooks, action links, mini-app, calendar pages) answer first, and any
// other GET on this host gets the site's 404 page.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { Router } from 'express';

export interface SiteConfig {
  /** The built site: dist/site. */
  dir: string;
  /** The hostname of APP_BASE_URL. */
  host: string;
}

/** Clean paths of the site and their files in dist/site. */
const PAGES: Record<string, string> = {
  '/': 'index.html',
  '/wachtlijst/bijna': 'wachtlijst-bijna.html',
  '/wachtlijst/bevestigd': 'wachtlijst-bevestigd.html',
  '/wachtlijst/fout': 'wachtlijst-fout.html',
};

/** Pages are checked often, so a deploy shows up within minutes. */
const PAGE_CACHE = 'public, max-age=300';

export function createSiteStatic(config: SiteConfig): Router {
  const router = Router();
  const assets = express.static(config.dir, { index: false, maxAge: '365d', immutable: true });
  const files = express.static(config.dir, { index: false, maxAge: '1d', extensions: [] });
  const page = (name: string) => join(config.dir, name);

  router.use((req, res, next) => {
    if (req.hostname !== config.host || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
    if (!existsSync(page('index.html'))) return next();
    const notFound = () => res.status(404).set('Cache-Control', PAGE_CACHE).sendFile(page('404.html'));
    const known = PAGES[req.path];
    if (known) return void res.set('Cache-Control', PAGE_CACHE).sendFile(page(known));
    if (req.path.startsWith('/assets/')) return assets(req, res, notFound);
    // Other files (favicon, robots.txt), but never the HTML pages under another name.
    if (!req.path.endsWith('.html')) return files(req, res, notFound);
    notFound();
  });
  return router;
}
