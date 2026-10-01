// POST /webhooks/telegram: checks the secret token header, answers 200 at once and
// processes asynchronously (BOUWPLAN.md, 9.2).
import express, { Router } from 'express';
import { safeEqual } from '../../lib/secrets.js';

export interface TelegramWebhookConfig {
  secretToken: string | undefined;
  onUpdate?: (body: unknown) => Promise<unknown>;
  log?: Pick<Console, 'warn' | 'error'>;
}

export function createTelegramWebhookRouter(config: TelegramWebhookConfig): Router {
  const router = Router();
  const log = config.log ?? console;

  router.post('/webhooks/telegram', express.json({ limit: '1mb' }), (req, res) => {
    if (!safeEqual(req.get('x-telegram-bot-api-secret-token'), config.secretToken)) {
      log.warn('Rejected Telegram webhook with a missing or wrong secret token');
      res.sendStatus(401);
      return;
    }

    res.sendStatus(200);

    if (config.onUpdate) {
      config.onUpdate(req.body as unknown).catch((error: unknown) => {
        log.error('Telegram update processing failed:', error);
      });
    }
  });

  return router;
}
