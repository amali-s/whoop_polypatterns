// Application-level token encryption (AES-256-GCM).
//
// WHOOP OAuth access/refresh tokens are encrypted with this helper BEFORE
// they are written to Supabase, and decrypted only inside serverless
// functions when a request to WHOOP must be made. This keeps plaintext
// tokens out of the database at rest.
//
// SECURITY:
//   - This module is server-only. It lives outside /src and must never be
//     imported into frontend code (it reads a secret from process.env).
//   - The key comes from the TOKEN_ENCRYPTION_KEY env var (set in Vercel
//     only — never committed). Generate one with:  openssl rand -base64 32
//   - No key is hardcoded here. If the env var is missing or the wrong size,
//     these functions throw rather than silently using a weak key.
//
// This is Phase 0 scaffolding: the structure is in place so storage code can
// call encryptToken()/decryptToken() without reinventing the format.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce — the value recommended for GCM
const KEY_LENGTH = 32; // 256-bit key
const FIELD_SEP = ':';

/** Decode and validate the 256-bit key from the environment. */
function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('TOKEN_ENCRYPTION_KEY is not set (server env var).');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes; got ${key.length}. ` +
        'Generate one with: openssl rand -base64 32',
    );
  }
  return key;
}

/**
 * Encrypt a plaintext string (e.g. a WHOOP token).
 * Returns a self-describing string: base64(iv):base64(authTag):base64(ciphertext).
 * Store this single string in one Postgres column.
 */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(
    FIELD_SEP,
  );
}

/**
 * Reverse encryptToken(). Throws if the payload is malformed or the auth tag
 * fails verification (tampering / wrong key).
 */
export function decryptToken(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(FIELD_SEP);
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted payload.');
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
