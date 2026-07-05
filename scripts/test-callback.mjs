// scripts/test-callback.mjs
//
// Unit test for the Phase 2.5 "paused database during OAuth" path added to the
// OAuth callback (api/callback.ts). This is the path a LOGGED-OUT user hits
// when the free-tier Supabase project is paused: /api/session short-circuits
// to connected:false without a DB read (no session cookie), so the user never
// sees the polling "waking" screen — they click Connect WHOOP, complete the
// OAuth consent, and the callback tries to upsert their tokens into the paused
// project. Before 2.5's callback fix that surfaced as a cryptic
// "Failed to store tokens"; now it redirects back to the SPA with a clear,
// banner-friendly database_unavailable message.
//
// Like test-session/test-refresh/test-webhook: drives the REAL handler with a
// mocked global `fetch` (WHOOP token endpoint + WHOOP profile + Supabase), NO
// creds, NO network.
//
// It proves:
//   * a paused/unreachable DB on the token UPSERT (fetch-level failure →
//     postgrest-js status-0 sentinel) → 302 redirect to
//     /?whoop_error=database_unavailable, state cookie cleared, NO session
//     cookie set, and no token material in the redirect URL;
//   * a GENUINE upsert failure (a real PostgREST error, status 500) still →
//     500 "Failed to store tokens", NOT the database_unavailable redirect;
//   * the happy path still sets a session cookie and redirects to the app
//     (guards against the classification hijacking a healthy connect).
//
// USAGE (from the repo root):
//   npm run test:callback        # = node scripts/test-callback.mjs
//
// Same .js → .ts resolve hook as the other test scripts.

import { register } from 'node:module';

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

// ── Dummy server config (read lazily; no real secrets) ───────────────────────
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.SUPABASE_URL = 'http://mock.supabase.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key';
process.env.WHOOP_CLIENT_ID = 'mock-client-id';
process.env.WHOOP_CLIENT_SECRET = 'mock-client-secret';
process.env.WHOOP_REDIRECT_URI = 'http://localhost:3000/api/callback';

const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const WHOOP_PROFILE_URL = 'https://api.prod.whoop.com/developer/v2/user/profile/basic';

// `upsertHandler` decides what the Supabase upsert does per case. WHOOP token +
// profile always succeed so every case reaches the storage step under test.
let upsertHandler = null; // (init) => Response | throws

global.fetch = async (url, init = {}) => {
  const target = String(url);
  const method = (init.method || 'GET').toUpperCase();

  if (target.startsWith(WHOOP_TOKEN_URL)) {
    return new Response(
      JSON.stringify({
        access_token: 'ACCESS_1',
        refresh_token: 'REFRESH_1',
        expires_in: 3600,
        scope: 'offline read:recovery',
        token_type: 'bearer',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (target.startsWith(WHOOP_PROFILE_URL)) {
    return new Response(JSON.stringify({ user_id: 999 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (target.startsWith(process.env.SUPABASE_URL)) {
    // callback.ts only writes (upsert = POST) in the path under test.
    if (method === 'POST') {
      return upsertHandler(init);
    }
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  throw new Error(`Unexpected fetch to ${method} ${target}`);
};

const handler = (await import('../api/callback.ts')).default;
// The handler console.error()s failures by design; silence for readable output.
console.error = () => {};

// ── Tiny assertion harness ───────────────────────────────────────────────────
let failures = 0;
function check(name, cond) {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL:'} ${name}`);
  if (!cond) failures += 1;
}

const STATE = 'csrf-state-token';

/** Minimal node:http req/res doubles for the callback handler. */
function makeReq() {
  return {
    url: `/api/callback?code=auth-code-123&state=${STATE}`,
    headers: { cookie: `whoop_oauth_state=${STATE}` },
  };
}
function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    end(chunk) {
      this.body = String(chunk ?? '');
    },
  };
}

async function callCallback() {
  const res = makeRes();
  await handler(makeReq(), res);
  const setCookie = res.headers['set-cookie'] ?? [];
  return {
    status: res.statusCode,
    location: res.headers['location'] ?? null,
    setCookie: Array.isArray(setCookie) ? setCookie : [setCookie],
    body: res.body,
  };
}

async function run() {
  // ── Case 1: paused DB on upsert (fetch fails → status 0) → clear redirect. ─
  console.log('\nCase 1: paused DB on token upsert → database_unavailable redirect');
  upsertHandler = () => {
    // What an unreachable/paused project produces: undici throws; postgrest-js
    // catches it and reports status 0. (A live 540 would behave the same via
    // isDbUnavailableStatus; status 0 is the harder-to-fake sentinel to assert.)
    throw new TypeError('fetch failed');
  };
  const r1 = await callCallback();
  check('302 redirect', r1.status === 302);
  check(
    'redirects to app with whoop_error=database_unavailable',
    typeof r1.location === 'string' &&
      r1.location.startsWith('/?') &&
      r1.location.includes('whoop_error=database_unavailable'),
  );
  check(
    'state cookie cleared',
    r1.setCookie.some((c) => c.startsWith('whoop_oauth_state=;')),
  );
  check(
    'NO session cookie set (connection was not stored)',
    !r1.setCookie.some((c) => c.startsWith('whoop_session=') && !c.startsWith('whoop_session=;')),
  );
  check('no token material in redirect URL', !r1.location.includes('ACCESS_1'));

  // ── Case 2: genuine upsert failure → 500, NOT the DB-unavailable redirect. ─
  console.log('\nCase 2: genuine PostgREST upsert error (500) → 500, not a waking redirect');
  upsertHandler = () =>
    new Response(JSON.stringify({ message: 'permission denied', code: '42501' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  const r2 = await callCallback();
  check('status 500', r2.status === 500);
  check('generic "Failed to store tokens" body', /Failed to store tokens/.test(r2.body));
  check('no redirect', r2.location === null);

  // ── Case 3: healthy upsert → session cookie + redirect to app. ─────────────
  console.log('\nCase 3: healthy upsert → session established, redirect to app');
  upsertHandler = () =>
    new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  const r3 = await callCallback();
  check('302 redirect', r3.status === 302);
  check('redirects to app root', r3.location === '/');
  check(
    'session cookie set',
    r3.setCookie.some((c) => c.startsWith('whoop_session=') && !c.startsWith('whoop_session=;')),
  );

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => {
  console.log('UNEXPECTED TEST HARNESS FAILURE:', e);
  process.exit(1);
});
