import express, { type Express } from 'express';
import { createWhatsAppWebhookRouter } from './channels/whatsapp/webhook.js';

export interface AppOptions {
  whatsapp?: {
    verifyToken: string | undefined;
    appSecret: string | undefined;
    onPayload?: (body: unknown) => Promise<unknown>;
  };
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(
    createWhatsAppWebhookRouter({
      verifyToken: options.whatsapp?.verifyToken,
      appSecret: options.whatsapp?.appSecret,
      ...(options.whatsapp?.onPayload && { onPayload: options.whatsapp.onPayload }),
    }),
  );

  return app;
}
