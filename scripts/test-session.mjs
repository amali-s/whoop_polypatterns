// scripts/test-session.mjs
//
// Unit test for the Phase 2.5 "waking database" classification, driven through
// the REAL /api/session handler (api/session.ts) → refresh.ts → tokens.ts →
// supabase-js, with a mocked global `fetch` standing in for both Supabase's
// PostgREST gateway and the WHOOP token endpoint. Like test-refresh.mjs /
// test-webhook.mjs: NO creds, NO network, not a re-implementation.
//
// It proves, deterministically and without being able to pause a real Supabase
// project from here:
//   * a paused project (the DOCUMENTED HTTP 540 "Project Paused" gateway
//     response) → 503 { connected:false, waking:true }, with no token
//     material, status codes, or dependency names in the body;
//   * an unreachable project (fetch-level failure → postgrest-js's status-0
//     sentinel) → the same 503 waking response;
//   * a 540 on the refresh-path UPDATE (project pauses between the token read
//     and the rotated-token write) → also classified as waking;
//   * GENUINE failures still surface as before and are NOT reported as
//     waking: a PostgREST 500 and a corrupt ciphertext both → flat 500;
//   * the no-cookie and healthy-row paths are unchanged (200s).
//
// USAGE (from the repo root):
//   npm run test:session        # = node scripts/test-session.mjs
//
// NOTE: the "unreachable" case takes ~7s — postgrest-js internally retries
// fetch-level failures on GET three times (1s/2s/4s backoff) before giving up.
// That built-in retry is part of the real behavior under test, so we let it run.
//
// Same .js → .ts resolve hook as the other test scripts (Node 24 strips types
// natively but won't resolve a `.js` specifier to a sibling `.ts`).

import { register } from 'node:module';

// ── .js → .ts resolve hook (same as scripts/test-refresh.mjs) ────────────────
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

// ── Dummy server config (read lazily by the modules; no real secrets) ────────
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.SUPABASE_URL = 'http://mock.supabase.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key';
process.env.WHOOP_CLIENT_ID = 'mock-client-id';
process.env.WHOOP_CLIENT_SECRET = 'mock-client-secret';

const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';

// ── In-memory whoop_tokens row + configurable Supabase/WHOOP responders ─────
// `supabaseHandler` decides what PostgREST returns (or throws) per request so
// each case can simulate healthy / paused / unreachable / broken.
const store = { row: null };
let supabaseCalls = 0;
let supabaseHandler = null; // (method) => Response | throws; null = healthy default
let whoopHandler = () => {
  throw new Error('WHOOP token endpoint should not have been called');
};

function healthySupabase(method, init) {
  if (method === 'GET') {
    if (!store.row) {
      return new Response('null', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const { access_token_encrypted, refresh_token_encrypted, expires_at, scope } = store.row;
    return new Response(
      JSON.stringify({ access_token_encrypted, refresh_token_encrypted, expires_at, scope }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (method === 'PATCH') {
    store.row = { ...store.row, ...JSON.parse(init.body) };
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  throw new Error(`Unexpected Supabase method ${method}`);
}

global.fetch = async (url, init = {}) => {
  const target = String(url);
  const method = (init.method || 'GET').toUpperCase();
  if (target.startsWith(WHOOP_TOKEN_URL)) {
    return whoopHandler(new URLSearchParams(init.body));
  }
  if (target.startsWith(process.env.SUPABASE_URL)) {
    supabaseCalls += 1;
    const result = supabaseHandler ? supabaseHandler(method, init) : null;
    return result ?? healthySupabase(method, init);
  }
  throw new Error(`Unexpected fetch to ${method} ${target}`);
};

// Import AFTER the mock + env are in place.
const { encryptToken } = await import('../api/_lib/crypto.ts');
const { encodeSession } = await import('../api/_lib/tokens.ts');
const handler = (await import('../api/session.ts')).default;

// The handler console.error()s every failure path by design; silence it so the
// test output stays readable (failures are asserted on the response instead).
console.error = () => {};

// ── Tiny assertion harness ───────────────────────────────────────────────────
let failures = 0;
function check(name, cond) {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL:'} ${name}`);
  if (!cond) failures += 1;
}

const USER_ID = 'member-123';

/** Seed store.row with encrypted tokens and an expiry `offsetMs` from now. */
function seedRow(offsetMs, { corruptCiphertext = false } = {}) {
  store.row = {
    user_id: USER_ID,
    access_token_encrypted: corruptCiphertext ? 'not:valid:ciphertext' : encryptToken('ACCESS_1'),
    refresh_token_encrypted: encryptToken('REFRESH_1'),
    expires_at: new Date(Date.now() + offsetMs).toISOString(),
    scope: 'offline read:recovery',
  };
}

/** Minimal stand-ins for node:http's IncomingMessage / ServerResponse. */
function makeReq(withCookie) {
  return { headers: withCookie ? { cookie: `whoop_session=${encodeSession(USER_ID)}` } : {} };
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

/** Run the real handler and return { status, headers, json, raw }. */
async function callSession({ cookie = true } = {}) {
  const res = makeRes();
  await handler(makeReq(cookie), res);
  let json = null;
  try {
    json = JSON.parse(res.body);
  } catch {
    /* leave null */
  }
  return { status: res.statusCode, headers: res.headers, json, raw: res.body };
}

/** The body must never leak token material, dependency names, or statuses. */
function leaksNothing(raw) {
  const lowered = raw.toLowerCase();
  return (
    !lowered.includes('supabase') &&
    !lowered.includes('postgrest') &&
    !lowered.includes('540') &&
    !raw.includes('ACCESS_1') &&
    !raw.includes('REFRESH_1')
  );
}

async function run() {
  // ── Case 1: no session cookie → 200 connected:false, no DB touched. ────────
  console.log('\nCase 1: no cookie → 200 connected:false, Supabase never called');
  supabaseCalls = 0;
  supabaseHandler = null;
  const r1 = await callSession({ cookie: false });
  check('status 200', r1.status === 200);
  check('connected:false', r1.json?.connected === false);
  check('no waking flag', !('waking' in (r1.json ?? {})));
  check('Supabase not called', supabaseCalls === 0);

  // ── Case 2: healthy fresh row → 200 connected:true, nothing leaked. ────────
  console.log('\nCase 2: healthy fresh row → 200 connected:true');
  seedRow(60 * 60 * 1000); // +1h — no refresh needed
  supabaseHandler = null;
  const r2 = await callSession();
  check('status 200', r2.status === 200);
  check('connected:true with userId', r2.json?.connected === true && r2.json?.userId === USER_ID);
  check('no token material in body', leaksNothing(r2.raw));

  // ── Case 3: paused project → documented 540 → 503 waking:true. ─────────────
  console.log('\nCase 3: paused project (HTTP 540 from the gateway) → 503 waking');
  seedRow(60 * 60 * 1000);
  supabaseHandler = () =>
    // What Supabase's API gateway actually sends for a paused project: the
    // documented 540 "Project Paused". Body shape is not contractual; the
    // classification keys ONLY on the status.
    new Response(JSON.stringify({ message: 'Project paused' }), {
      status: 540,
      headers: { 'Content-Type': 'application/json' },
    });
  const r3 = await callSession();
  check('status 503', r3.status === 503);
  check('waking:true', r3.json?.waking === true);
  check('connected:false', r3.json?.connected === false);
  check('Retry-After header set', r3.headers['retry-after'] === '5');
  check('leaks no internals (no "supabase"/"540"/tokens)', leaksNothing(r3.raw));

  // ── Case 4: unreachable project → fetch throws → status-0 → 503 waking. ────
  console.log('\nCase 4: unreachable project (fetch-level failure) → 503 waking');
  console.log('  (takes ~7s: postgrest-js retries GET network failures 3× internally)');
  seedRow(60 * 60 * 1000);
  supabaseHandler = () => {
    // What a project mid-restore/teardown produces: no HTTP response at all.
    // undici surfaces this as TypeError('fetch failed'); postgrest-js catches
    // it (after its own retries) and reports status 0 — the sentinel we classify.
    throw new TypeError('fetch failed');
  };
  const r4 = await callSession();
  check('status 503', r4.status === 503);
  check('waking:true', r4.json?.waking === true);
  check('leaks no internals', leaksNothing(r4.raw));

  // ── Case 5: genuine PostgREST failure (500) → flat 500, NOT waking. ────────
  console.log('\nCase 5: genuine PostgREST 500 → 500, not classified as waking');
  seedRow(60 * 60 * 1000);
  supabaseHandler = () =>
    new Response(JSON.stringify({ message: 'internal error', code: 'XX000' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  const r5 = await callSession();
  check('status 500', r5.status === 500);
  check('no waking flag', !('waking' in (r5.json ?? {})));
  check('generic error message', r5.json?.error === 'Failed to check session.');

  // ── Case 6: corrupt ciphertext → integrity error → 500, NOT waking. ────────
  console.log('\nCase 6: row exists but ciphertext corrupt → 500, not waking');
  seedRow(60 * 60 * 1000, { corruptCiphertext: true });
  supabaseHandler = null; // Supabase healthy; decryption is what fails
  const r6 = await callSession();
  check('status 500', r6.status === 500);
  check('no waking flag', !('waking' in (r6.json ?? {})));

  // ── Case 7: project pauses between read and rotated-token write. ───────────
  console.log('\nCase 7: 540 on the refresh-path UPDATE → 503 waking');
  seedRow(60 * 1000); // +60s — inside the 5-min skew, forces a refresh
  whoopHandler = () =>
    new Response(
      JSON.stringify({
        access_token: 'ACCESS_2',
        refresh_token: 'REFRESH_2',
        expires_in: 3600,
        scope: 'offline read:recovery',
        token_type: 'bearer',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  supabaseHandler = (method, init) => {
    if (method === 'PATCH') {
      return new Response(JSON.stringify({ message: 'Project paused' }), {
        status: 540,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return healthySupabase(method, init);
  };
  const r7 = await callSession();
  check('status 503', r7.status === 503);
  check('waking:true', r7.json?.waking === true);
  check('leaks no internals', leaksNothing(r7.raw));

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => {
  // console.error is stubbed; use log so real harness failures still print.
  console.log('UNEXPECTED TEST HARNESS FAILURE:', e);
  process.exit(1);
});
