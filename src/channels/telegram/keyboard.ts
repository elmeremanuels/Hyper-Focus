import type { Button, OutboundMessage } from '../../conversation/types.js';
import type { InlineKeyboardMarkup } from './client.js';

// Limits from BOUWPLAN.md 9.2.
export const MAX_PER_ROW = 3;
export const MAX_ROWS = 3;
export const MAX_CHOICES = 8;
export const MAX_TITLE = 20;
export const MAX_CALLBACK_BYTES = 64;
export const MAX_TEXT = 4096;

export function toInlineKeyboard(message: OutboundMessage): InlineKeyboardMarkup | undefined {
  if (message.choices && message.choices.length > 0) {
    if (message.choices.length > MAX_CHOICES) {
      throw new Error(`A choice list holds at most ${MAX_CHOICES} rows`);
    }
    return { inline_keyboard: message.choices.map((choice) => [toButton(choice)]) };
  }

  const buttons = message.buttons ?? [];
  if (buttons.length === 0) return undefined;
  if (buttons.length > MAX_PER_ROW * MAX_ROWS) {
    throw new Error(`At most ${MAX_PER_ROW * MAX_ROWS} buttons per message`);
  }

  const rows = [];
  for (let index = 0; index < buttons.length; index += MAX_PER_ROW) {
    rows.push(buttons.slice(index, index + MAX_PER_ROW).map(toButton));
  }
  return { inline_keyboard: rows };
}

function toButton(button: Button) {
  if (Buffer.byteLength(button.id, 'utf8') > MAX_CALLBACK_BYTES) {
    throw new Error(`Button id longer than ${MAX_CALLBACK_BYTES} bytes: ${button.id}`);
  }
  const title = button.title.length <= MAX_TITLE ? button.title : `${button.title.slice(0, MAX_TITLE - 1)}…`;
  return { text: title, callback_data: button.id };
}

/** Splits text longer than Telegram's limit at a line break where possible. */
export function splitText(text: string, limit = MAX_TEXT): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const cut = rest.lastIndexOf('\n', limit);
    const at = cut > limit / 2 ? cut : limit;
    parts.push(rest.slice(0, at));
    rest = rest.slice(at).replace(/^\n/, '');
  }
  parts.push(rest);
  return parts;
}
