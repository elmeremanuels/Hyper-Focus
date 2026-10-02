// GET /a/{token} shows a page that confirms the action; the page submits itself, so a
// person taps once. Mail scanners that only fetch links do not run the action.
// POST /a/{token} runs the button through the router and shows the reply (BOUWPLAN.md, 9.3).
import express, { Router, type Response } from 'express';
import type { MessageStore } from '../../core/messages.js';
import type { UserStore } from '../../core/users.js';
import type { Router as ConversationRouter } from '../../conversation/router.js';
import type { OutboundMessage } from '../../conversation/types.js';
import { actionUrl, createActionToken, verifyActionToken } from './links.js';
import { escapeHtml, page } from './page.js';

export interface ActionRouteConfig {
  secret: string | undefined;
  baseUrl: string | undefined;
  users: UserStore;
  messages: MessageStore;
  router: ConversationRouter;
  now?: () => Date;
}

export const ACTION_TEXTS = {
  invalid: 'Deze link klopt niet.',
  expired: 'Deze link is verlopen. Open de laatste mail of Telegram voor een nieuwe keuze.',
  used: 'Deze link is al gebruikt. Elke link werkt één keer.',
  confirm: 'Even bevestigen',
  confirmButton: 'Uitvoeren',
} as const;

export function createActionRouter(config: ActionRouteConfig): Router {
  const router = Router();
  const now = config.now ?? (() => new Date());

  router.get('/a/:token', (req, res) => {
    const result = config.secret ? verifyActionToken(req.params.token, config.secret, now()) : undefined;
    if (!result?.ok) {
      sendPage(res, result?.reason === 'expired' ? 410 : 404, ACTION_TEXTS[result?.reason ?? 'invalid']);
      return;
    }
    const action = `/a/${encodeURIComponent(req.params.token)}`;
    res
      .status(200)
      .type('html')
      .send(
        page(
          ACTION_TEXTS.confirm,
          `<form method="post" action="${escapeHtml(action)}"><button type="submit">${ACTION_TEXTS.confirmButton}</button></form>
<script>document.forms[0].submit();</script>`,
        ),
      );
  });

  router.post('/a/:token', express.urlencoded({ extended: false }), async (req, res, next) => {
    try {
      const result = config.secret ? verifyActionToken(req.params.token, config.secret, now()) : undefined;
      if (!result?.ok) {
        sendPage(res, result?.reason === 'expired' ? 410 : 404, ACTION_TEXTS[result?.reason ?? 'invalid']);
        return;
      }
      const { userId, buttonId, nonce } = result.payload;
      const user = await config.users.findById(userId);
      if (!user) {
        sendPage(res, 404, ACTION_TEXTS.invalid);
        return;
      }

      const isNew = await config.messages.recordInbound({
        userId,
        channel: 'web',
        externalId: `a:${nonce}`,
        type: 'action_link',
        body: buttonId,
      });
      if (!isNew) {
        sendPage(res, 410, ACTION_TEXTS.used);
        return;
      }

      await config.messages.touchLastInbound(userId, now());
      await config.messages.recordEvent(userId, 'inbound_message', { channel: 'email', type: 'action_link' });

      const replies = await config.router({ kind: 'button', userId, buttonId, title: buttonId, source: 'web' });
      res.status(200).type('html').send(page('Gelukt', replies.map((reply) => renderReply(reply, userId)).join('')));
    } catch (error) {
      next(error);
    }
  });

  function renderReply(reply: OutboundMessage, userId: number): string {
    const buttons = reply.choices ?? reply.buttons ?? [];
    const { secret, baseUrl } = config;
    const links =
      secret && baseUrl
        ? buttons
            .map((button) => {
              const url = actionUrl(baseUrl, createActionToken(userId, button.id, secret, now()));
              return `<a class="button" href="${escapeHtml(url)}">${escapeHtml(button.title)}</a>`;
            })
            .join(' ')
        : '';
    return `<p>${escapeHtml(reply.text).replace(/\n/g, '<br>')}</p>${links ? `<p>${links}</p>` : ''}`;
  }

  return router;
}

function sendPage(res: Response, status: number, text: string): void {
  res.status(status).type('html').send(page('Hyper&Focus', `<p>${escapeHtml(text)}</p>`));
}
