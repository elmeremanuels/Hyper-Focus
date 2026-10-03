// The dashboard API (fase 2a), behind the session check.
import express, { Router } from 'express';
import { requireSession } from '../auth/routes.js';
import { jsonOnly, type DashboardRoutesConfig } from './common.js';
import { parkingRoutes } from './parking.js';
import { projectRoutes } from './projects.js';
import { settingsRoutes } from './settings.js';
import { todayRoutes } from './today.js';

export type { DashboardRoutesConfig };

/** Every path of the dashboard API; /api/battery and /api/focus-log check their own sign-in. */
const GUARDED = ['/api/today', '/api/tasks', '/api/window', '/api/projects', '/api/clients', '/api/parking', '/api/ideas', '/api/settings', '/api/export', '/api/account'];

export function createDashboardRoutes(config: DashboardRoutesConfig): Router {
  const router = Router();
  router.use(GUARDED, requireSession(config), jsonOnly, express.json({ limit: '16kb' }));
  router.use(todayRoutes(config));
  router.use(projectRoutes(config));
  router.use(parkingRoutes(config));
  router.use(settingsRoutes(config));
  return router;
}
