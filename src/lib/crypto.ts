// Harvested from Publicato-personal server/utils/tokenEncryption.ts.
// Changed: the key comes only from ENCRYPTION_KEY; the hardcoded fallback secret is removed.
import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function deriveKey(secret: string | undefined): Buffer {
  if (!secret) {
    throw new Error('ENCRYPTION_KEY is not configured');
  }
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptToken(value: string, secret: string | undefined): string {
  if (!value) {
    throw new Error('Value to encrypt must be a non-empty string');
  }

  const key = deriveKey(secret);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString('base64'), encrypted.toString('base64'), authTag.toString('base64')].join(
    '.',
  );
}

export function decryptToken(payload: string, secret: string | undefined): string {
  if (!payload) {
    throw new Error('Encrypted payload is required for decryption');
  }

  const [ivB64, encryptedB64, authTagB64] = payload.split('.');
  if (!ivB64 || !encryptedB64 || !authTagB64) {
    throw new Error('Invalid encrypted payload format');
  }

  const key = deriveKey(secret);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
