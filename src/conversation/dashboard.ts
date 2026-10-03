// "Open dashboard" from Telegram (step 2a.1): a one-time login link as a URL button.
import { createLoginToken } from '../web/auth/sessions.js';
import { loginUrl } from '../web/auth/routes.js';
import { LOGIN_TEXTS } from '../texts/dashboard.nl.js';
import type { ButtonContext, ButtonExtension, ParsedButton } from './buttons.js';
import type { OutboundMessage } from './types.js';

export async function dashboardLink(ctx: Pick<ButtonContext, 'db' | 'userId' | 'now'>, baseUrl: string | undefined): Promise<OutboundMessage> {
  if (!baseUrl) return { text: LOGIN_TEXTS.off };
  const token = await createLoginToken(ctx.db, ctx.userId, 'telegram', ctx.now);
  if (!token) return { text: LOGIN_TEXTS.tooMany };
  return { text: LOGIN_TEXTS.telegram, buttons: [{ id: 'db:link', title: LOGIN_TEXTS.telegramButton, url: loginUrl(baseUrl, token) }] };
}

/** db:open */
export function dashboardButtons(baseUrl: string | undefined): ButtonExtension {
  return async (button: ParsedButton, ctx) => (button.kind === 'dashboard' ? [await dashboardLink(ctx, baseUrl)] : undefined);
}
