import crypto from 'node:crypto';

/**
 * Verifies Meta's X-Hub-Signature-256 header (HMAC-SHA256 of the raw body with the app secret).
 * Fails closed: a missing secret or header is invalid.
 */
export function isValidSignature(
  rawBody: Buffer,
  header: string | undefined,
  appSecret: string | undefined,
): boolean {
  if (!appSecret || !header?.startsWith('sha256=')) {
    return false;
  }

  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest();
  const received = Buffer.from(header.slice('sha256='.length), 'hex');

  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

export function signBody(rawBody: Buffer | string, appSecret: string): string {
  return `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}
