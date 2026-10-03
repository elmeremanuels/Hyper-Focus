import type { OutboundMessage } from '../../../conversation/types.js';
import { escapeHtml } from '../../actions/page.js';

/** Renders a router message as mail: text plus buttons as action links (BOUWPLAN.md, 9.3). */
export function renderMessageMail(
  message: OutboundMessage,
  linkFor: ((buttonId: string) => string) | undefined,
): { text: string; html: string } {
  const buttons = message.rows?.flat() ?? message.choices ?? message.buttons ?? [];
  // Link buttons go straight to their URL; other buttons become signed action links.
  const links = buttons.flatMap((button) =>
    (button.url ?? button.webApp) ? [{ title: button.title, url: (button.url ?? button.webApp) as string }] : linkFor ? [{ title: button.title, url: linkFor(button.id) }] : [],
  );

  const text = [
    message.text,
    ...(links.length > 0 ? ['', ...links.map((link) => `${link.title}: ${link.url}`)] : []),
    '',
    'Antwoorden kan ook: reageer gewoon op deze mail.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="nl"><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1a1a1a;max-width:36rem">
<p>${escapeHtml(message.text).replace(/\n/g, '<br>')}</p>
${
  links.length > 0
    ? `<p>${links
        .map(
          (link) =>
            `<a href="${escapeHtml(link.url)}" style="display:inline-block;margin:4px 4px 4px 0;padding:10px 16px;border-radius:8px;background:#1a1a1a;color:#ffffff;text-decoration:none">${escapeHtml(link.title)}</a>`,
        )
        .join('')}</p>`
    : ''
}
<p style="color:#666;font-size:14px">Antwoorden kan ook: reageer gewoon op deze mail.</p>
</body></html>`;

  return { text, html };
}
