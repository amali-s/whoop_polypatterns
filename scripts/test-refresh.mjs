// scripts/test-refresh.mjs
//
// Unit test for the Phase 1.5 refresh path (api/_lib/refresh.ts). There is no
// test runner wired into this repo, so this is a self-contained Node script that
// drives the REAL module — not a re-implementation — with a mocked `fetch`.
//
// Everything the module touches (the Supabase REST call AND the WHOOP token
// endpoint) goes through global `fetch`, so a single fetch mock lets us exercise
// the whole code path deterministically with NO network and NO credentials. That
// is deliberate: it covers cases a live run can't (a rejected refresh, the
// rotation race) WITHOUT rotating your real WHOOP refresh token or corrupting the
// stored row. Because it needs no creds and isn't part of `build`/`lint`, it
// never runs in CI on its own.
//
// USAGE (from the repo root):
//   npm run test:refresh        # = node scripts/test-refresh.mjs
//
// Two implementation notes:
//   * Node 24 strips TypeScript types natively, but does NOT resolve a `.js`
//     import specifier to a sibling `.ts` file. The tiny resolve hook registered
//     below maps `./foo.js` → `./foo.ts` so we can import the real module graph.
//   * We set dummy server env vars in-process before importing the module; the
//     module reads them lazily, so no real secrets are involved.

import { register } from 'node:module';

// ── .js → .ts resolve hook (so the real api/_lib/*.ts graph imports cleanly) ──
const loaderSrc = `
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js')) {
    try {
      const u = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
      if (existsSync(fileURLToPath(u))) return { url: u.href, shortCircuit: true };
    } catch {}
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(loaderSrc), import.meta.url);

// ── Dummy server config (read lazily by the module; no real secrets) ─────────
// A valid 32-byte base64 key so encrypt/decrypt round-trips inside the module.
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.SUPABASE_URL = 'http://mock.supabase.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key';
process.env.WHOOP_CLIENT_ID = 'mock-client-id';
process.env.WHOOP_CLIENT_SECRET = 'mock-client-secret';

const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';

// ── In-memory whoop_tokens row + a configurable WHOOP responder ──────────────
// `store.row` holds the single row's ENCRYPTED columns (as Supabase would).
// `whoopHandler` decides what the WHOOP token endpoint returns for a test.
// `whoopCalls` counts how many times WHOOP was hit (to assert "no refresh").
const store = { row: null };
let whoopHandler = () => {
  throw new Error('WHOOP token endpoint should not have been called');
};
let whoopCalls = 0;

global.fetch = async (url, init = {}) => {
  const target = String(url);
  const method = init.method || 'GET';

  // WHOOP token endpoint (refresh request).
  if (target.startsWith(WHOOP_TOKEN_URL)) {
    whoopCalls += 1;
    const params = new URLSearchParams(init.body);
    return whoopHandler(params);
  }

  // Supabase PostgREST: GET = select, PATCH = update.
  if (target.startsWith(process.env.SUPABASE_URL)) {
    if (method === 'GET') {
      // maybeSingle() expects a single JSON object, or null when no row.
      if (!store.row) {
        return new Response('null', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const { access_token_encrypted, refresh_token_encrypted, expires_at, scope } = store.row;
      return new Response(
        JSON.stringify({ access_token_encrypted, refresh_token_encrypted, expires_at, scope }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (method === 'PATCH') {
      // Apply the update to the in-memory row, like an UPDATE ... WHERE user_id.
      const patch = JSON.parse(init.body);
      store.row = { ...store.row, ...patch };
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  }

  throw new Error(`Unexpected fetch to ${method} ${target}`);
};

// Import AFTER the mock + env are in place. crypto.ts is imported directly (.ts)
// so the test can seed/inspect encrypted columns with the SAME format the module
// uses; refresh.ts is the code under test.
const { encryptToken, decryptToken } = await import('../api/_lib/crypto.ts');
const { ensureFreshTokens } = await import('../api/_lib/refresh.ts');

// ── Tiny assertion harness ───────────────────────────────────────────────────
let failures = 0;
function check(name, cond) {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL:'} ${name}`);
  if (!cond) failures += 1;
}

const USER_ID = 'member-123';

/** Seed store.row with encrypted tokens and an expiry `offsetMs` from now. */
function seedRow(accessToken, refreshToken, offsetMs, scope = 'offline read:recovery') {
  store.row = {
    user_id: USER_ID,
    access_token_encrypted: encryptToken(accessToken),
    refresh_token_encrypted: encryptToken(refreshToken),
    expires_at: new Date(Date.now() + offsetMs).toISOString(),
    scope,
    updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  };
}

function whoopOk(accessToken, refreshToken, extra = {}) {
  return (params) => {
    // Sanity-check the request shape the module sends.
    if (params.get('grant_type') !== 'refresh_token') throw new Error('bad grant_type');
    return new Response(
      JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 3600,
        scope: 'offline read:recovery',
        token_type: 'bearer',
        ...extra,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
}

function whoopReject() {
  return () =>
    new Response(JSON.stringify({ error: 'invalid_grant' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
}

async function run() {
  // ── Case 1: token NOT near expiry → no refresh, row untouched. ─────────────
  console.log('\nCase 1: token not near expiry → no refresh, row untouched');
  seedRow('ACCESS_1', 'REFRESH_1', 60 * 60 * 1000); // +1h
  whoopCalls = 0;
  whoopHandler = () => {
    throw new Error('WHOOP must not be called when the token is fresh');
  };
  const before = JSON.stringify(store.row);
  const t1 = await ensureFreshTokens(USER_ID);
  check('returns the existing access token', t1?.accessToken === 'ACCESS_1');
  check('did not call WHOOP', whoopCalls === 0);
  check('row left untouched', JSON.stringify(store.row) === before);

  // ── Case 2: near expiry → refresh, row updated with new tokens + expiry. ───
  console.log('\nCase 2: near expiry → refresh rotates + persists new tokens');
  seedRow('ACCESS_1', 'REFRESH_1', 60 * 1000); // +60s (inside 5-min skew)
  whoopCalls = 0;
  whoopHandler = whoopOk('ACCESS_2', 'REFRESH_2');
  const t2 = await ensureFreshTokens(USER_ID);
  check('called WHOOP exactly once', whoopCalls === 1);
  check('returns the NEW access token', t2?.accessToken === 'ACCESS_2');
  check('returns the NEW (rotated) refresh token', t2?.refreshToken === 'REFRESH_2');
  check(
    'persisted new access token (decrypts to ACCESS_2)',
    decryptToken(store.row.access_token_encrypted) === 'ACCESS_2',
  );
  check(
    'persisted rotated refresh token (decrypts to REFRESH_2)',
    decryptToken(store.row.refresh_token_encrypted) === 'REFRESH_2',
  );
  check(
    'recomputed expires_at well into the future',
    new Date(store.row.expires_at).getTime() - Date.now() > 50 * 60 * 1000,
  );

  // ── Case 2b: rotation with WHOOP omitting refresh_token → keep existing. ───
  console.log('\nCase 2b: refresh omits refresh_token → keep existing (NOT NULL)');
  seedRow('ACCESS_1', 'REFRESH_KEEP', 60 * 1000);
  whoopCalls = 0;
  whoopHandler = whoopOk('ACCESS_3', undefined); // refresh_token omitted
  const t2b = await ensureFreshTokens(USER_ID);
  check('returns new access token', t2b?.accessToken === 'ACCESS_3');
  check('keeps the previous refresh token', t2b?.refreshToken === 'REFRESH_KEEP');
  check(
    'stored refresh token is not null and unchanged',
    decryptToken(store.row.refresh_token_encrypted) === 'REFRESH_KEEP',
  );

  // ── Case 3: refresh rejected → error surfaces, row NOT corrupted. ──────────
  console.log('\nCase 3: refresh rejected by WHOOP → throws, row not corrupted');
  seedRow('ACCESS_1', 'REFRESH_1', 60 * 1000);
  whoopHandler = whoopReject();
  const rowBefore = JSON.stringify(store.row);
  let threw = false;
  try {
    await ensureFreshTokens(USER_ID);
  } catch {
    threw = true;
  }
  check('surfaced an error', threw);
  check('row NOT corrupted (tokens unchanged)', JSON.stringify(store.row) === rowBefore);
  check(
    'refresh token still present and valid',
    decryptToken(store.row.refresh_token_encrypted) === 'REFRESH_1',
  );

  // ── Case 4: rotation race → WHOOP rejects, but a concurrent request already ──
  //    refreshed; the module re-reads and uses the freshly stored token.
  console.log('\nCase 4: rotation race → 4xx but re-read row is fresh → use it');
  seedRow('ACCESS_1', 'REFRESH_1', 60 * 1000);
  whoopHandler = () => {
    // Simulate a concurrent request having JUST rotated + stored a fresh token
    // before our (now-stale) refresh token is rejected.
    store.row = {
      user_id: USER_ID,
      access_token_encrypted: encryptToken('ACCESS_CONCURRENT'),
      refresh_token_encrypted: encryptToken('REFRESH_CONCURRENT'),
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      scope: 'offline read:recovery',
      updated_at: new Date().toISOString(),
    };
    return new Response(JSON.stringify({ error: 'invalid_grant' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const t4 = await ensureFreshTokens(USER_ID);
  check('did NOT throw (used concurrently-refreshed token)', !!t4);
  check('returned the concurrently-stored access token', t4?.accessToken === 'ACCESS_CONCURRENT');

  // ── Case 5: no row → null (not connected), not an error. ───────────────────
  console.log('\nCase 5: no row → null (not connected), not an error');
  store.row = null;
  const t5 = await ensureFreshTokens(USER_ID);
  check('returns null for a missing row', t5 === null);

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
