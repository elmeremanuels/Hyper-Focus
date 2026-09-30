// GET: harvested from the verify-token part of Publicato-personal
// server/routes/engagementRoutes.ts. POST: signature check on the raw body, immediate 200,
// asynchronous processing (BOUWPLAN.md, 9.3).
import express, { Router } from 'express';
import { isValidSignature } from './signature.js';

export interface WebhookConfig {
  verifyToken: string | undefined;
  appSecret: string | undefined;
  /** Called after the 200 response with the parsed JSON body. */
  onPayload?: (body: unknown) => Promise<unknown>;
  log?: Pick<Console, 'warn' | 'error'>;
}

export function createWhatsAppWebhookRouter(config: WebhookConfig): Router {
  const router = Router();
  const log = config.log ?? console;

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

  router.post(
    '/webhooks/whatsapp',
    // Keep the raw bytes: the signature is computed over the exact body Meta sent.
    express.raw({ type: '*/*', limit: '1mb' }),
    (req, res) => {
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!isValidSignature(rawBody, req.get('x-hub-signature-256'), config.appSecret)) {
        log.warn('Rejected WhatsApp webhook with an invalid signature');
        res.sendStatus(401);
        return;
      }

      let body: unknown;
      try {
        body = JSON.parse(rawBody.toString('utf8'));
      } catch {
        res.sendStatus(400);
        return;
      }

      res.sendStatus(200);

      if (config.onPayload) {
        config.onPayload(body).catch((error: unknown) => {
          log.error('WhatsApp webhook processing failed:', error);
        });
      }
    },
  );

  return router;
}
