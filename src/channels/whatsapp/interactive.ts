import type { Button, ListMenu } from '../../conversation/types.js';

// Graph API limits for interactive messages (BOUWPLAN.md, 9.4).
export const MAX_BUTTONS = 3;
export const MAX_BUTTON_TITLE = 20;
export const MAX_LIST_ROWS = 10;
export const MAX_ROW_TITLE = 24;
export const MAX_ROW_DESCRIPTION = 72;
export const MAX_BODY = 1024;

export function buttonsPayload(to: string, text: string, buttons: Button[]): Record<string, unknown> {
  if (buttons.length === 0 || buttons.length > MAX_BUTTONS) {
    throw new Error(`A button message needs 1 to ${MAX_BUTTONS} buttons`);
  }
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: limit(text, MAX_BODY) },
      action: {
        buttons: buttons.map((button) => ({
          type: 'reply',
          reply: { id: button.id, title: limit(button.title, MAX_BUTTON_TITLE) },
        })),
      },
    },
  };
}

export function listPayload(to: string, text: string, list: ListMenu): Record<string, unknown> {
  if (list.rows.length === 0 || list.rows.length > MAX_LIST_ROWS) {
    throw new Error(`A list message needs 1 to ${MAX_LIST_ROWS} rows`);
  }
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: limit(text, MAX_BODY) },
      action: {
        button: limit(list.button, MAX_BUTTON_TITLE),
        sections: [
          {
            rows: list.rows.map((row) => ({
              id: row.id,
              title: limit(row.title, MAX_ROW_TITLE),
              ...(row.description !== undefined && {
                description: limit(row.description, MAX_ROW_DESCRIPTION),
              }),
            })),
          },
        ],
      },
    },
  };
}

function limit(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
