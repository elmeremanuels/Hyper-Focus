import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { startServer, type RunningServer } from './helpers/server.js';

function get(base: string, path: string, host: string): Promise<{ status: number; body: string; cache: string | undefined }> {
  const url = new URL(path, base);
  return new Promise((resolve, reject) => {
    request({ hostname: url.hostname, port: url.port, path: url.pathname, headers: { host } }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, cache: res.headers['cache-control'] }));
    })
      .on('error', reject)
      .end();
  });
}

describe('website on the main host', () => {
  let server: RunningServer;
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hf-site-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<h1>Hyper&amp;Focus</h1>');
    writeFileSync(join(dir, '404.html'), '<h1>Niet gevonden</h1>');
    writeFileSync(join(dir, 'wachtlijst-bijna.html'), '<h1>Check je mail</h1>');
    writeFileSync(join(dir, 'favicon.svg'), '<svg/>');
    writeFileSync(join(dir, 'assets', 'styles-abc.css'), 'body{}');
    server = await startServer(
      createApp({ site: { dir, host: 'hyper-focus.invalid' }, dashboardWeb: { dir, host: 'app.hyper-focus.invalid' } }),
    );
  });
  afterAll(() => server.close());

  it('serves the page, its files and assets on the main host', async () => {
    const home = await get(server.baseUrl, '/', 'hyper-focus.invalid');
    expect([home.status, home.body, home.cache]).toEqual([200, '<h1>Hyper&amp;Focus</h1>', 'public, max-age=300']);
    expect((await get(server.baseUrl, '/favicon.svg', 'hyper-focus.invalid')).status).toBe(200);
    expect((await get(server.baseUrl, '/wachtlijst/bijna', 'hyper-focus.invalid')).body).toBe('<h1>Check je mail</h1>');
    const asset = await get(server.baseUrl, '/assets/styles-abc.css', 'hyper-focus.invalid');
    expect([asset.status, asset.cache]).toEqual([200, 'public, max-age=31536000, immutable']);
  });

  it('answers unknown paths with the 404 page, also for the HTML files by name', async () => {
    for (const path of ['/bestaat-niet', '/index.html', '/404.html', '/assets/weg.css']) {
      const res = await get(server.baseUrl, path, 'hyper-focus.invalid');
      expect([path, res.status, res.body]).toEqual([path, 404, '<h1>Niet gevonden</h1>']);
    }
  });

  it('leaves the server paths and the dashboard host alone', async () => {
    expect((await get(server.baseUrl, '/health', 'hyper-focus.invalid')).body).toBe('{"status":"ok"}');
    // The dashboard host keeps its own app.
    expect((await get(server.baseUrl, '/projecten', 'app.hyper-focus.invalid')).body).toBe('<h1>Hyper&amp;Focus</h1>');
    expect((await get(server.baseUrl, '/', 'ander.invalid')).status).toBe(404);
  });
});
