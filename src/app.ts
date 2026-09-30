import express, { type Express } from 'express';
import { createWhatsAppWebhookRouter } from './channels/whatsapp/webhook.js';

export interface AppOptions {
  whatsappVerifyToken?: string | undefined;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(createWhatsAppWebhookRouter({ verifyToken: options.whatsappVerifyToken }));

  return app;
}
