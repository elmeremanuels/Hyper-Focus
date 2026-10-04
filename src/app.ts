import express, { type Express } from 'express';
import { createActionRouter, type ActionRouteConfig } from './channels/actions/route.js';
import { createMailWebhookRouter, type InboundItem } from './channels/email/inbound.js';
import { createTelegramWebhookRouter } from './channels/telegram/webhook.js';
import { createCalendarRouter, type CalendarRouteConfig } from './integrations/calendar/routes.js';
import { createRewardRouter, type RewardRouteConfig } from './web/reward.js';
import { createDashboardApi, type DashboardApiConfig } from './web/dashboard-api.js';
import { createAuthRouter, type AuthConfig } from './web/auth/routes.js';
import { createDashboardStatic, type DashboardWebConfig } from './web/dashboard-static.js';
import { createSiteStatic, type SiteConfig } from './web/site-static.js';
import { createDashboardRoutes, type DashboardRoutesConfig } from './web/dashboard/index.js';

export interface AppOptions {
  telegram?: {
    secretToken: string | undefined;
    onUpdate?: (body: unknown) => Promise<unknown>;
  };
  mail?: {
    secret: string | undefined;
    onMail?: (item: InboundItem) => Promise<unknown>;
  };
  actions?: ActionRouteConfig;
  calendar?: CalendarRouteConfig;
  reward?: RewardRouteConfig;
  /** The dashboard (fase 2a): login and its API. Only with DASHBOARD_BASE_URL. */
  dashboardApi?: DashboardApiConfig;
  auth?: AuthConfig;
  dashboardWeb?: DashboardWebConfig;
  /** The website on the main host (fase 2b). Mounted last. */
  site?: SiteConfig;
  dashboard?: DashboardRoutesConfig;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  // Behind Nginx on the VPS.
  app.set('trust proxy', 'loopback');

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(
    createTelegramWebhookRouter({
      secretToken: options.telegram?.secretToken,
      ...(options.telegram?.onUpdate && { onUpdate: options.telegram.onUpdate }),
    }),
  );
  app.use(
    createMailWebhookRouter({
      secret: options.mail?.secret,
      ...(options.mail?.onMail && { onMail: options.mail.onMail }),
    }),
  );
  if (options.actions) {
    app.use(createActionRouter(options.actions));
  }
  if (options.auth) {
    app.use(createAuthRouter(options.auth));
  }
  if (options.dashboard) {
    app.use(createDashboardRoutes(options.dashboard));
  }
  if (options.dashboardApi) {
    app.use(createDashboardApi(options.dashboardApi));
  }
  if (options.reward) {
    app.use(createRewardRouter(options.reward));
  }
  if (options.calendar) {
    app.use(createCalendarRouter(options.calendar));
  }
  if (options.dashboardWeb) {
    app.use(createDashboardStatic(options.dashboardWeb));
  }
  if (options.site) {
    app.use(createSiteStatic(options.site));
  }

  return app;
}
