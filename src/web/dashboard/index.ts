// The dashboard API (fase 2a), behind the session check.
import express, { Router } from 'express';
import { requireSession } from '../auth/routes.js';
import { assistantRoutes } from './assistant.js';
import { contentRoutes } from './content.js';
import { jsonOnly, type DashboardRoutesConfig } from './common.js';
import { parkingRoutes } from './parking.js';
import { projectRoutes } from './projects.js';
import { settingsRoutes } from './settings.js';
import { todayRoutes } from './today.js';

export type { DashboardRoutesConfig };

/** Every path of the dashboard API; /api/battery and /api/focus-log check their own sign-in. */
const GUARDED = ['/api/logo', '/api/today', '/api/tasks', '/api/window', '/api/projects', '/api/clients', '/api/parking', '/api/ideas', '/api/settings', '/api/export', '/api/account', '/api/assistant'];

export function createDashboardRoutes(config: DashboardRoutesConfig): Router {
  const router = Router();
  // The logo upload parses its own (larger) body; every other path stays at 16 kB.
  router.use(GUARDED, requireSession(config), jsonOnly);
  const json = express.json({ limit: '16kb' });
  router.use(GUARDED, (req, res, next) => (req.originalUrl.startsWith('/api/logo/') && req.method === 'PUT' ? next() : json(req, res, next)));
  router.use(todayRoutes(config));
  router.use(projectRoutes(config));
  router.use(contentRoutes(config));
  router.use(parkingRoutes(config));
  router.use(settingsRoutes(config));
  router.use(assistantRoutes(config));
  return router;
}
