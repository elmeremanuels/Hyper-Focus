import { request } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { BREVO_DOI_URL, BrevoError, requestDoubleOptin } from '../src/integrations/brevo/double-optin.js';
import { startServer, type RunningServer } from './helpers/server.js';

const HOST = 'hyper-focus.invalid';

function post(base: string, form: Record<string, string>, host = HOST): Promise<{ status: number; location: string | undefined }> {
  const url = new URL('/wachtlijst', base);
  const body = new URLSearchParams(form).toString();
  return new Promise((resolve, reject) => {
    request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { host, 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location }));
      },
    )
      .on('error', reject)
      .end(body);
  });
}

describe('waiting list form', () => {
  let server: RunningServer;
  const signup = vi.fn(async (_email: string) => undefined);
  let clock = new Date('2026-10-05T10:00:00Z');
  beforeAll(async () => {
    server = await startServer(createApp({ waitlist: { host: HOST, signup, now: () => clock } }));
  });
  afterAll(() => server.close());
  beforeEach(() => signup.mockClear());

  it('asks Brevo for the confirmation mail with a valid address and consent', async () => {
    expect(await post(server.baseUrl, { email: ' Noor@Voorbeeld.invalid ', toestemming: 'ja', website: '' })).toEqual({ status: 303, location: '/wachtlijst/bijna' });
    expect(signup).toHaveBeenCalledWith('noor@voorbeeld.invalid');
  });

  it('refuses a missing consent or a wrong address', async () => {
    expect((await post(server.baseUrl, { email: 'noor@voorbeeld.invalid' })).location).toBe('/wachtlijst/fout');
    expect((await post(server.baseUrl, { email: 'geen-adres', toestemming: 'ja' })).location).toBe('/wachtlijst/fout');
    expect(signup).not.toHaveBeenCalled();
  });

  it('gives a bot the normal answer and does nothing', async () => {
    expect((await post(server.baseUrl, { email: 'bot@voorbeeld.invalid', toestemming: 'ja', website: 'https://spam.invalid' })).location).toBe('/wachtlijst/bijna');
    expect(signup).not.toHaveBeenCalled();
  });

  it('sends at most 5 mails an hour to one address', async () => {
    clock = new Date('2026-10-05T12:00:00Z');
    for (let i = 0; i < 7; i++) await post(server.baseUrl, { email: 'vaak@voorbeeld.invalid', toestemming: 'ja' });
    expect(signup).toHaveBeenCalledTimes(5);
    // An hour later it works again.
    clock = new Date('2026-10-05T13:30:00Z');
    await post(server.baseUrl, { email: 'vaak@voorbeeld.invalid', toestemming: 'ja' });
    expect(signup).toHaveBeenCalledTimes(6);
  });

  it('only answers on the main host, and says so when Brevo fails or is not set up', async () => {
    clock = new Date('2026-10-05T20:00:00Z');
    expect((await post(server.baseUrl, { email: 'a@voorbeeld.invalid', toestemming: 'ja' }, 'app.hyper-focus.invalid')).status).toBe(404);
    signup.mockRejectedValueOnce(new BrevoError(400, 'Invalid template'));
    expect((await post(server.baseUrl, { email: 'b@voorbeeld.invalid', toestemming: 'ja' })).location).toBe('/wachtlijst/fout');

    const off = await startServer(createApp({ waitlist: { host: HOST, signup: undefined } }));
    try {
      expect((await post(off.baseUrl, { email: 'c@voorbeeld.invalid', toestemming: 'ja' })).location).toBe('/wachtlijst/fout');
    } finally {
      await off.close();
    }
  });
});

describe('Brevo double opt-in', () => {
  const config = { apiKey: 'test-key', listId: 7, templateId: 12, redirectionUrl: 'https://hyper-focus.invalid/wachtlijst/bevestigd' };

  it('posts the address, the list and the template', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 201 }));
    await requestDoubleOptin(config, 'noor@voorbeeld.invalid', fetchImpl as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(BREVO_DOI_URL);
    expect(init?.headers).toMatchObject({ 'api-key': 'test-key' });
    expect(JSON.parse(String(init?.body))).toEqual({ email: 'noor@voorbeeld.invalid', includeListIds: [7], templateId: 12, redirectionUrl: config.redirectionUrl });
  });

  it('throws with Brevo’s message on an error', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ message: 'Invalid templateId' }, { status: 400 }));
    await expect(requestDoubleOptin(config, 'noor@voorbeeld.invalid', fetchImpl as typeof fetch)).rejects.toThrow('Brevo double opt-in failed (400): Invalid templateId');
  });
});
