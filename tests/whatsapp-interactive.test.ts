import { describe, expect, it } from 'vitest';
import { buttonsPayload, listPayload } from '../src/channels/whatsapp/interactive.js';

describe('interactive payloads', () => {
  it('builds reply buttons and cuts titles to 20 characters', () => {
    const payload = buttonsPayload('+31600000000', 'Kies', [
      { id: 't:1:done', title: 'Gedaan' },
      { id: 't:1:tomorrow', title: 'Morgen verder met deze taak' },
    ]) as { interactive: { action: { buttons: Array<{ reply: { id: string; title: string } }> } } };

    const buttons = payload.interactive.action.buttons;
    expect(buttons[0]?.reply).toEqual({ id: 't:1:done', title: 'Gedaan' });
    expect(buttons[1]?.reply.title.length).toBe(20);
  });

  it('refuses more than three buttons', () => {
    const four = [1, 2, 3, 4].map((n) => ({ id: `b${n}`, title: `Knop ${n}` }));
    expect(() => buttonsPayload('+31600000000', 'Kies', four)).toThrow();
  });

  it('builds a list and refuses more than ten rows', () => {
    const rows = Array.from({ length: 10 }, (_, n) => ({ id: `t:${n}:park`, title: `Taak ${n}` }));
    const payload = listPayload('+31600000000', 'Afronden', { button: 'Kies', rows }) as {
      interactive: { type: string; action: { sections: Array<{ rows: unknown[] }> } };
    };
    expect(payload.interactive.type).toBe('list');
    expect(payload.interactive.action.sections[0]?.rows).toHaveLength(10);

    expect(() =>
      listPayload('+31600000000', 'Afronden', { button: 'Kies', rows: [...rows, { id: 'x', title: 'x' }] }),
    ).toThrow();
  });
});
