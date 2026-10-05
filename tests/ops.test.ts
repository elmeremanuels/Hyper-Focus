import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createAlerter } from '../src/ops/alerts.js';
import { checkAnthropic, checkOpenAI, checkTelegramWebhook, creditProblem } from '../src/ops/checks.js';
import { watchErrors } from '../src/ops/error-watch.js';
import { heartbeatAge, writeHeartbeat } from '../src/ops/heartbeat.js';
import { startServer } from './helpers/server.js';

const NOW = new Date('2026-10-07T06:00:00Z');
const quiet = { warn: () => undefined };

describe('alerts', () => {
  it('sends by Telegram and mail, and the same alert at most once per six hours', async () => {
    let clock = NOW;
    const telegram = vi.fn(async (_t: string) => undefined);
    const email = vi.fn(async (_s: string, _t: string) => undefined);
    const alert = createAlerter({ telegram, email, now: () => clock, log: quiet });
    await alert('worker', 'De worker draait niet.');
    await alert('worker', 'De worker draait niet.');
    expect(telegram).toHaveBeenCalledTimes(1);
    expect(telegram.mock.calls[0]?.[0]).toBe('⚠️ Hyper&Focus: De worker draait niet.');
    expect(email).toHaveBeenCalledWith('Melding: worker', '⚠️ Hyper&Focus: De worker draait niet.');
    await alert('other', 'Iets anders.');
    expect(telegram).toHaveBeenCalledTimes(2);
    clock = new Date(NOW.getTime() + 6 * 3_600_000 + 1);
    await alert('worker', 'De worker draait niet.');
    expect(telegram).toHaveBeenCalledTimes(3);
  });

  it('never throws when a channel fails', async () => {
    const alert = createAlerter({ telegram: async () => Promise.reject(new Error('down')), log: quiet });
    await expect(alert('x', 'y')).resolves.toBeUndefined();
  });

  it('alerts after more than five errors in an hour', async () => {
    const alert = vi.fn(async () => undefined);
    const original = console.error;
    console.error = () => undefined;
    const stop = watchErrors(alert, 'test', () => NOW);
    for (let i = 0; i < 5; i++) console.error('fout', i);
    expect(alert).not.toHaveBeenCalled();
    console.error(new Error('de zesde'));
    expect(alert).toHaveBeenCalledWith('errors:test', '6 fouten in een uur in test. Laatste: de zesde');
    stop();
    console.error = original;
  });
});

describe('worker heartbeat and /health', () => {
  it('answers 503 without a fresh heartbeat, 200 with one', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'hf-beat-')), 'beat');
    const server = await startServer(createApp({ heartbeatFile: file }));
    try {
      expect((await fetch(`${server.baseUrl}/health`)).status).toBe(503);
      await writeHeartbeat(file, new Date(Date.now() - 6 * 60_000));
      expect(await (await fetch(`${server.baseUrl}/health`)).json()).toEqual({ status: 'worker_down' });
      await writeHeartbeat(file, new Date());
      expect(await (await fetch(`${server.baseUrl}/health`)).json()).toEqual({ status: 'ok' });
      expect(await heartbeatAge(file, new Date(Date.now() + 1000))).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
    // Without a heartbeat file (development): always ok.
    const plain = await startServer(createApp({}));
    try {
      expect((await fetch(`${plain.baseUrl}/health`)).status).toBe(200);
    } finally {
      await plain.close();
    }
  });
});

describe('checks', () => {
  it('reads the Telegram webhook info', async () => {
    const info = (over: object) => ({ getWebhookInfo: async () => ({ url: 'https://hyper-focus.invalid/webhooks/telegram', pending_update_count: 0, ...over }) });
    expect(await checkTelegramWebhook(info({}), NOW)).toBeUndefined();
    expect(await checkTelegramWebhook(info({ pending_update_count: 12 }), NOW)).toBe('Telegram heeft 12 berichten in de wacht.');
    expect(await checkTelegramWebhook(info({ last_error_date: NOW.getTime() / 1000 - 600, last_error_message: 'Connection refused' }), NOW)).toBe(
      'Telegram meldt een fout bij de webhook: Connection refused.',
    );
    expect(await checkTelegramWebhook(info({ last_error_date: NOW.getTime() / 1000 - 7200 }), NOW)).toBeUndefined();
    expect(await checkTelegramWebhook(info({ url: '' }), NOW)).toBe('De Telegram-webhook staat niet ingesteld.');
  });

  it('recognises credit and key problems from Anthropic and OpenAI', async () => {
    expect(creditProblem(new Error('400 {"type":"error","error":{"message":"Your credit balance is too low to access the Anthropic API."}}'))).toBe(
      'Het tegoed bij de AI-leverancier is op.',
    );
    expect(creditProblem(new Error('429 insufficient_quota'))).toBe('Het tegoed bij de AI-leverancier is op.');
    expect(creditProblem(new Error('401 authentication_error: invalid x-api-key'))).toBe('De API-sleutel van de AI-leverancier werkt niet.');
    expect(creditProblem(new Error('529 overloaded'))).toBeUndefined();

    expect(await checkAnthropic({ generate: async () => 'ok' })).toBeUndefined();
    expect(await checkAnthropic({ generate: async () => Promise.reject(new Error('credit balance is too low')) })).toBe('Anthropic: Het tegoed bij de AI-leverancier is op.');
    const openai = (status: number, body = '') => vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;
    expect(await checkOpenAI('sk-test', openai(200))).toBeUndefined();
    expect(await checkOpenAI('sk-test', openai(429, '{"error":{"code":"insufficient_quota"}}'))).toBe('OpenAI: Het tegoed bij de AI-leverancier is op.');
  });
});
