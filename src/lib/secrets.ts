import crypto from 'node:crypto';

/** Constant-time string comparison. False when either side is missing. */
export function safeEqual(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function hmac(secret: string, purpose: string, value: string): Buffer {
  return crypto.createHmac('sha256', secret).update(`${purpose}:${value}`).digest();
}

/** Keeps ids and addresses out of logs: 123456789 → 12*****89, sam@x.nl → s**@x.nl. */
export function mask(value: string | number): string {
  const text = String(value);
  const at = text.indexOf('@');
  if (at > 0) {
    return `${text[0]}${'*'.repeat(Math.max(at - 1, 1))}${text.slice(at)}`;
  }
  if (text.length <= 4) return '****';
  return `${text.slice(0, 2)}${'*'.repeat(text.length - 4)}${text.slice(-2)}`;
}
