import { describe, expect, it } from 'vitest';
import { createMemoryRouterDeps } from '../src/conversation/deps.js';
import { createRouter, type RouterDeps } from '../src/conversation/router.js';

const userId = 1;
const openTasks = [
  { id: 11, title: 'Factuur versturen', estimatedMinutes: 5, projectTitle: 'Losse taken' },
  { id: 12, title: 'Offerte afmaken', estimatedMinutes: 60, projectTitle: 'Website' },
  { id: 13, title: 'Banner maken', estimatedMinutes: null, projectTitle: 'Website' },
  { id: 14, title: 'Vierde taak', estimatedMinutes: 15, projectTitle: 'Website' },
];

describe('router', () => {
  const router = createRouter(createMemoryRouterDeps('Sam', openTasks));

  it('greets by name and offers the focus', async () => {
    const [reply] = await router({ kind: 'text', userId, text: 'Hoi!' });
    expect(reply?.text).toContain('Hoi Sam');
    expect(reply?.buttons?.[0]?.id).toBe('f:show');
  });

  it('shows at most three tasks with start buttons', async () => {
    const [reply] = await router({ kind: 'text', userId, text: 'wat staat er vandaag' });
    expect(reply?.text).toContain('1. Factuur versturen · 5 min');
    expect(reply?.text).toContain('3. Banner maken');
    expect(reply?.text).not.toContain('Vierde taak');
    expect(reply?.buttons?.map((button) => button.id)).toEqual([
      't:11:start',
      't:12:start',
      't:13:start',
    ]);
  });

  it('handles the show button without text matching', async () => {
    const [reply] = await router({ kind: 'button', userId, buttonId: 'f:show', title: 'Laat zien' });
    expect(reply?.text).toContain('Vandaag, in deze volgorde');
  });

  it('handles a start button', async () => {
    const [reply] = await router({ kind: 'button', userId, buttonId: 't:12:start', title: 'Start 2' });
    expect(reply?.text).toContain('succes');
  });

  it('replies to an empty task list', async () => {
    const empty = createRouter(createMemoryRouterDeps('Sam'));
    const [reply] = await empty({ kind: 'text', userId, text: 'vandaag' });
    expect(reply?.text).toContain('Er staat niets open');
  });

  it('answers an unknown user briefly', async () => {
    const deps: RouterDeps = { findUserName: async () => undefined, listOpenTasks: async () => [] };
    const [reply] = await createRouter(deps)({ kind: 'text', userId: 99, text: 'hoi' });
    expect(reply?.text).toBe('Je account ken ik nog niet.');
  });

  it('keeps every reply within the WhatsApp limits and the tone rules', async () => {
    const inputs = ['hoi', 'vandaag', 'help', 'klant wil banner voor vrijdag'];
    for (const text of inputs) {
      for (const reply of await router({ kind: 'text', userId, text })) {
        expect(reply.text.length).toBeLessThanOrEqual(300);
        expect(reply.buttons?.length ?? 0).toBeLessThanOrEqual(3);
        for (const button of reply.buttons ?? []) {
          expect(button.title.length).toBeLessThanOrEqual(20);
        }
        expect(reply.text).not.toMatch(/achterstand|te laat|vergeten|alweer|nog steeds|je moet|je had/i);
      }
    }
  });
});
