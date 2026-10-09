import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  ACTION_LINK_TTL_MS,
  actionUrl,
  createActionToken,
  verifyActionToken,
} from '../src/channels/actions/links.js';
import { ACTION_TEXTS } from '../src/channels/actions/route.js';
import { escapeHtml } from '../src/channels/actions/page.js';
import { createMemoryRouterDeps } from '../src/conversation/deps.js';
import { createRouter } from '../src/conversation/router.js';
import { MemoryMessageStore, MemoryUserStore, sam } from './helpers/memory.js';
import { startServer, type RunningServer } from './helpers/server.js';

const SECRET = 'k'.repeat(32);
const NOW = new Date('2026-10-01T08:00:00Z');

describe('action tokens', () => {
  it('round-trips user, button id and expiry', () => {
    const result = verifyActionToken(createActionToken(1, 't:12:done', SECRET, NOW), SECRET, NOW);
    expect(result).toMatchObject({
      ok: true,
      payload: { userId: 1, buttonId: 't:12:done', expiresAt: new Date(NOW.getTime() + ACTION_LINK_TTL_MS) },
    });
  });

  it('gives every token its own nonce', () => {
    const a = verifyActionToken(createActionToken(1, 'f:show', SECRET, NOW), SECRET, NOW);
    const b = verifyActionToken(createActionToken(1, 'f:show', SECRET, NOW), SECRET, NOW);
    expect(a.ok && b.ok && a.payload.nonce !== b.payload.nonce).toBe(true);
  });

  it('expires after 7 days', () => {
    const token = createActionToken(1, 'f:show', SECRET, NOW);
    const later = new Date(NOW.getTime() + ACTION_LINK_TTL_MS + 1000);
    expect(verifyActionToken(token, SECRET, later)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a changed payload, another secret and garbage', () => {
    const token = createActionToken(1, 'f:show', SECRET, NOW);
    const [body, signature] = token.split('.') as [string, string];
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), u: 2 }),
    ).toString('base64url');

    expect(verifyActionToken(`${forged}.${signature}`, SECRET, NOW)).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyActionToken(token, 'z'.repeat(32), NOW)).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyActionToken('abc', SECRET, NOW)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('builds the URL', () => {
    expect(actionUrl('https://hyper-focus.pro/', 'abc.def')).toBe('https://hyper-focus.pro/a/abc.def');
  });
});

describe('GET and POST /a/:token', () => {
  let server: RunningServer | undefined;
  let messages: MemoryMessageStore;
  let now = NOW;

  afterEach(async () => {
    await server?.close();
    server = undefined;
    now = NOW;
  });

  async function start() {
    messages = new MemoryMessageStore();
    server = await startServer(
      createApp({
        actions: {
          secret: SECRET,
          baseUrl: 'https://hyper-focus.invalid',
          users: new MemoryUserStore([sam()]),
          messages,
          router: createRouter(
            createMemoryRouterDeps('Sam', [
              { id: 11, title: 'Factuur versturen', estimatedMinutes: 5, projectTitle: 'Losse taken' },
            ]),
          ),
          now: () => now,
        },
      }),
    );
    return server;
  }

  it('GET only shows a confirmation page and runs nothing', async () => {
    const { baseUrl } = await start();
    const token = createActionToken(1, 'f:show', SECRET, NOW);

    const response = await fetch(`${baseUrl}/a/${token}`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(`<form method="post" action="/a/${token}">`);
    expect(messages.messages).toHaveLength(0);
  });

  it('POST runs the button once and shows the reply with new action links', async () => {
    const { baseUrl } = await start();
    const token = createActionToken(1, 'f:show', SECRET, NOW);

    const first = await fetch(`${baseUrl}/a/${token}`, { method: 'POST' });
    const html = await first.text();
    expect(first.status).toBe(200);
    expect(html).toContain('Vandaag, in deze volgorde');
    expect(html).toContain('href="https://hyper-focus.invalid/a/');
    expect(messages.inbound()).toMatchObject([{ channel: 'web', type: 'action_link', body: 'f:show' }]);

    const second = await fetch(`${baseUrl}/a/${token}`, { method: 'POST' });
    expect(second.status).toBe(410);
    expect(await second.text()).toContain(escapeHtml(ACTION_TEXTS.used));
    expect(messages.inbound()).toHaveLength(1);
  });

  it('refuses an expired link', async () => {
    const { baseUrl } = await start();
    const token = createActionToken(1, 'f:show', SECRET, NOW);
    now = new Date(NOW.getTime() + ACTION_LINK_TTL_MS + 1000);

    const response = await fetch(`${baseUrl}/a/${token}`, { method: 'POST' });
    expect(response.status).toBe(410);
    expect(await response.text()).toContain(escapeHtml(ACTION_TEXTS.expired));
  });

  it('refuses a forged link', async () => {
    const { baseUrl } = await start();
    const response = await fetch(`${baseUrl}/a/${createActionToken(1, 'f:show', 'z'.repeat(32), NOW)}`, {
      method: 'POST',
    });
    expect(response.status).toBe(404);
    expect(messages.messages).toHaveLength(0);
  });
});
