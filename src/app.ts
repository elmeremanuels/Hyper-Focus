import express, { type Express } from 'express';
import { createActionRouter, type ActionRouteConfig } from './channels/actions/route.js';
import { createMailWebhookRouter, type InboundItem } from './channels/email/inbound.js';
import { createTelegramWebhookRouter } from './channels/telegram/webhook.js';
import { createCalendarRouter, type CalendarRouteConfig } from './integrations/calendar/routes.js';

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
  if (options.calendar) {
    app.use(createCalendarRouter(options.calendar));
  }

  return app;
}
