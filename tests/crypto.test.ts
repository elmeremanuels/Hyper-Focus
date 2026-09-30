import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken } from '../src/lib/crypto.js';

describe('token encryption', () => {
  it('round-trips a value', () => {
    const encrypted = encryptToken('refresh-token', 'secret');
    expect(encrypted).not.toContain('refresh-token');
    expect(decryptToken(encrypted, 'secret')).toBe('refresh-token');
  });

  it('fails with the wrong key', () => {
    const encrypted = encryptToken('refresh-token', 'secret');
    expect(() => decryptToken(encrypted, 'other')).toThrow();
  });

  it('requires a configured key', () => {
    expect(() => encryptToken('x', undefined)).toThrow(/ENCRYPTION_KEY/);
  });

  it('rejects a malformed payload', () => {
    expect(() => decryptToken('abc', 'secret')).toThrow(/format/);
  });
});
