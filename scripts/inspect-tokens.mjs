// scripts/inspect-tokens.mjs
//
// Post-auth sanity check for Phase 1.4 → 1.5: reads the whoop_tokens row(s),
// decrypts both tokens with the SAME AES-256-GCM format as api/_lib/crypto.ts,
// and reports user_id / scope / expiry. It deliberately NEVER prints token
// material — only that decryption succeeded, the token length, and a masked
// 4-char prefix — so this is safe to run and paste output from.
//
// Run it after you complete a live "Connect WHOOP" so we can confirm 1.4 wrote
// a usable row before building the 1.5 refresh logic (which has nothing to
// refresh until this passes).
//
// USAGE (from the repo root):
//   1. vercel env pull .env.local      # pulls SUPABASE_* and TOKEN_ENCRYPTION_KEY
//   2. npm run inspect:tokens          # = node --env-file=.env.local scripts/inspect-tokens.mjs
//
// It reuses only @supabase/supabase-js (already a dependency) and node:crypto —
// no new packages, no tsx, so it runs on plain Node.

import { createDecipheriv } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const FIELD_SEP = ':';
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;

function getKey() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error('TOKEN_ENCRYPTION_KEY is not set.');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new Error(`TOKEN_ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes; got ${key.length}.`);
  }
  return key;
}

// Mirror of api/_lib/crypto.ts decryptToken(): payload = iv:tag:ciphertext (b64).
function decryptToken(payload) {
  const [ivB64, tagB64, dataB64] = String(payload).split(FIELD_SEP);
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Malformed encrypted payload.');
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

// Show only enough to prove identity without leaking the secret.
function safeReport(label, token) {
  return `${label}: decrypt OK (len ${token.length}, starts "${token.slice(0, 4)}…")`;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('SUPABASE_URL is not set.');
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.');
  // Touch the key early so a bad/missing key fails loudly before the DB query.
  getKey();

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from('whoop_tokens')
    .select(
      'user_id, access_token_encrypted, refresh_token_encrypted, expires_at, scope, updated_at',
    );

  if (error) throw new Error(`Failed to read whoop_tokens: ${error.message}`);

  if (!data || data.length === 0) {
    console.log('No rows in whoop_tokens yet — has a live "Connect WHOOP" completed?');
    return;
  }

  console.log(`Found ${data.length} row(s) in whoop_tokens:\n`);
  const now = Date.now();
  for (const row of data) {
    console.log(`user_id:    ${row.user_id}`);
    console.log(`scope:      ${row.scope ?? '(none)'}`);
    if (row.expires_at) {
      const ms = new Date(row.expires_at).getTime() - now;
      const mins = Math.round(ms / 60000);
      console.log(
        `expires_at: ${row.expires_at} (${ms >= 0 ? `in ~${mins} min` : `EXPIRED ~${-mins} min ago`})`,
      );
    } else {
      console.log('expires_at: (null)');
    }
    console.log(`updated_at: ${row.updated_at ?? '(none)'}`);
    try {
      console.log(safeReport('access_token ', decryptToken(row.access_token_encrypted)));
      console.log(safeReport('refresh_token', decryptToken(row.refresh_token_encrypted)));
    } catch (e) {
      console.error(`DECRYPT FAILED for user_id ${row.user_id}: ${e.message}`);
      process.exitCode = 1;
    }
    console.log('');
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
