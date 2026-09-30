import { describe, expect, it } from 'vitest';
import { isValidSignature, signBody } from '../src/channels/whatsapp/signature.js';

describe('isValidSignature', () => {
  const body = Buffer.from('{"object":"whatsapp_business_account"}');

  it('accepts a correct signature', () => {
    expect(isValidSignature(body, signBody(body, 'secret'), 'secret')).toBe(true);
  });

  it('rejects a signature made with another secret', () => {
    expect(isValidSignature(body, signBody(body, 'other'), 'secret')).toBe(false);
  });

  it('rejects a changed body', () => {
    const header = signBody(body, 'secret');
    expect(isValidSignature(Buffer.from(`${body.toString()} `), header, 'secret')).toBe(false);
  });

  it('rejects a missing header, a malformed header and a missing secret', () => {
    expect(isValidSignature(body, undefined, 'secret')).toBe(false);
    expect(isValidSignature(body, 'sha1=abc', 'secret')).toBe(false);
    expect(isValidSignature(body, 'sha256=zz', 'secret')).toBe(false);
    expect(isValidSignature(body, signBody(body, 'secret'), undefined)).toBe(false);
  });
});
