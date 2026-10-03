// Serves the built dashboard (dist/web) on the dashboard host only, e.g. app.hyper-focus.pro.
// Paths of the server itself (API, login, webhooks, mini-app) are never shadowed.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { Router } from 'express';

export interface DashboardWebConfig {
  /** The built app: dist/web. */
  dir: string;
  /** The hostname of DASHBOARD_BASE_URL. */
  host: string;
}

const SERVER_PATHS = /^\/(api|auth|login|app|a|webhooks|health)(\/|$)/;

export function createDashboardStatic(config: DashboardWebConfig): Router {
  const router = Router();
  const index = join(config.dir, 'index.html');
  const assets = express.static(config.dir, { index: false, maxAge: '365d', immutable: true });

  router.use((req, res, next) => {
    if (req.hostname !== config.host || SERVER_PATHS.test(req.path)) return next();
    if (req.path.startsWith('/assets/')) return assets(req, res, next);
    if (req.method !== 'GET' || !existsSync(index)) return next();
    // The app itself is never cached, so a deploy shows up right away.
    res.set('Cache-Control', 'no-store').sendFile(index);
  });
  return router;
}
