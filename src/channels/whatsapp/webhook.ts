// Harvested from the verify-token part of Publicato-personal server/routes/engagementRoutes.ts.
// Changed: WhatsApp route and verify token from config. The POST handler with
// signature check and idempotency is built in step 1.1 (BOUWPLAN.md, 9.3).
import { Router } from 'express';

export interface WebhookConfig {
  verifyToken: string | undefined;
}

export function createWhatsAppWebhookRouter(config: WebhookConfig): Router {
  const router = Router();

  router.get('/webhooks/whatsapp', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (
      config.verifyToken !== undefined &&
      mode === 'subscribe' &&
      token === config.verifyToken &&
      typeof challenge === 'string'
    ) {
      res.status(200).type('text/plain').send(challenge);
      return;
    }

    res.sendStatus(403);
  });

  return router;
}
