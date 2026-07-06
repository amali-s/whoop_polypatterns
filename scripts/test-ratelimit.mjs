// scripts/test-ratelimit.mjs
//
// Unit test for the Phase 2.7 rate-limit handling in the WHOOP API client
// (api/_lib/whoop.ts). Same pattern as scripts/test-refresh.mjs: it drives the
// REAL module — not a re-implementation — with a mocked global `fetch`, so it
// needs NO credentials and NO network. On top of that it monkey-patches global
// `setTimeout` to RECORD every requested wait and fire immediately, so the
// exact backoff / Retry-After / proactive-throttle delays are asserted
// deterministically and the whole script finishes instantly.
//
// It proves:
//   * parseRateLimitHeaders identifies the exhausted window from the
//     multi-value X-RateLimit-Limit header (minute=60 vs day=86400), and
//     degrades to 'unknown' on missing/garbled headers;
//   * a minute-window 429 is still retried with the existing backoff logic,
//     and Retry-After stays authoritative over the computed backoff;
//   * a day-window 429 fails FAST as WhoopRateLimitError — one fetch, zero
//     sleeps, no 30s-capped retries burned (even when Retry-After is present);
//   * an exhausted retry budget on a minute/unknown 429 throws the typed
//     WhoopRateLimitError (not the generic WhoopApiError);
//   * the proactive throttle sleeps until the reported reset when Remaining is
//     at/below RATE_LIMIT_SAFETY_BUFFER (=3), is a ZERO-latency no-op when
//     Remaining is comfortable, and does NOT sleep on a day-window observation
//     (a capped wait can't refill a 24h quota);
//   * unrelated retry paths (5xx, network failure, plain 4xx) are unchanged.
//
// USAGE (from the repo root):
//   npm run test:ratelimit      # = node scripts/test-ratelimit.mjs

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

// ── Dummy server config (read lazily by the module; no real secrets) ─────────
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.SUPABASE_URL = 'http://mock.supabase.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key';
process.env.WHOOP_CLIENT_ID = 'mock-client-id';
process.env.WHOOP_CLIENT_SECRET = 'mock-client-secret';

const WHOOP_API_PREFIX = 'https://api.prod.whoop.com/developer';

// ── Recorded, instant setTimeout ─────────────────────────────────────────────
// whoop.ts sleeps via `setTimeout(resolve, ms)`. Recording the requested ms and
// firing on a 0 delay makes every wait (backoff, Retry-After, proactive
// throttle) both observable and instant. The mocked fetch never fails at the
// transport level unless a case scripts it, so nothing else in the module
// graph depends on real timer durations.
const realSetTimeout = global.setTimeout;
const recordedSleeps = [];
global.setTimeout = (fn, ms, ...args) => {
  recordedSleeps.push(ms ?? 0);
  return realSetTimeout(fn, 0, ...args);
};

// ── Scripted WHOOP responder + mocked fetch ──────────────────────────────────
// `whoopQueue` holds one entry per expected WHOOP hit: a function returning a
// Response, or the string 'throw' (transport failure). The LAST entry repeats
// if the client keeps retrying. Supabase GETs serve the seeded token row.
let whoopQueue = [];
let whoopHits = 0;
const store = { row: null };

global.fetch = async (url) => {
  const target = String(url);

  if (target.startsWith(WHOOP_API_PREFIX)) {
    const step = whoopQueue[Math.min(whoopHits, whoopQueue.length - 1)];
    whoopHits += 1;
    if (step === 'throw') {
      throw new TypeError('fetch failed');
    }
    return step();
  }

  if (target.startsWith(process.env.SUPABASE_URL)) {
    // getWhoopTokens' maybeSingle() select — the only Supabase call this path
    // makes (the seeded token is far from expiry, so no refresh ever fires).
    const { access_token_encrypted, refresh_token_encrypted, expires_at, scope } = store.row;
    return new Response(
      JSON.stringify({ access_token_encrypted, refresh_token_encrypted, expires_at, scope }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  throw new Error(`Unexpected fetch to ${target}`);
};

// Import AFTER the mocks + env are in place (same ordering as test-refresh).
const { encryptToken } = await import('../api/_lib/crypto.ts');
const { getProfile, parseRateLimitHeaders, resetRateLimitTracking, WhoopRateLimitError } =
  await import('../api/_lib/whoop.ts');

const USER_ID = 'member-123';
store.row = {
  access_token_encrypted: encryptToken('ACCESS_TOKEN'),
  refresh_token_encrypted: encryptToken('REFRESH_TOKEN'),
  expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // +1h: never refreshes
  scope: 'offline read:profile',
};

// ── Tiny assertion harness ───────────────────────────────────────────────────
let failures = 0;
function check(name, cond) {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL:'} ${name}`);
  if (!cond) failures += 1;
}

/** Fresh state for each case: no carried-over throttle observation or sleeps. */
function resetCase(queue) {
  resetRateLimitTracking();
  whoopQueue = queue;
  whoopHits = 0;
  recordedSleeps.length = 0;
}

// ── Response builders ────────────────────────────────────────────────────────
// Header values follow the WHOOP docs examples (draft-polli-ratelimit-headers).
const MINUTE_LIMITS = '100, 100;window=60, 10000;window=86400';
const DAY_LIMITS = '10000, 100;window=60, 10000;window=86400';

function rlHeaders(limit, remaining, reset, extra = {}) {
  return {
    'X-RateLimit-Limit': limit,
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Reset': String(reset),
    ...extra,
  };
}

function whoopResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const PROFILE = { user_id: 1, email: 'x@example.com', first_name: 'A', last_name: 'B' };
const ok = (headers) => () => whoopResponse(200, PROFILE, headers);
const status429 = (headers) => () => whoopResponse(429, { error: 'too many requests' }, headers);

async function expectThrow(fn) {
  try {
    await fn();
    return null;
  } catch (err) {
    return err;
  }
}

async function run() {
  // ── Case 1: pure header parsing — window identification. ───────────────────
  console.log('\nCase 1: parseRateLimitHeaders — multi-value window identification');
  const pMin = parseRateLimitHeaders(MINUTE_LIMITS, '98', '3');
  check('docs example → minute window', pMin?.window === 'minute');
  check('remaining parsed (98)', pMin?.remaining === 98);
  check('resetSeconds parsed (3)', pMin?.resetSeconds === 3);
  const pDay = parseRateLimitHeaders(DAY_LIMITS, '0', '43200');
  check('day quota first → day window', pDay?.window === 'day');
  check('day resetSeconds parsed (43200)', pDay?.resetSeconds === 43200);
  check('all headers absent → null', parseRateLimitHeaders(null, null, null) === null);
  const pBare = parseRateLimitHeaders('100', '98', '3');
  check(
    "no window params → 'unknown' (remaining still parsed)",
    pBare?.window === 'unknown' && pBare?.remaining === 98,
  );
  const pGarbled = parseRateLimitHeaders('nonsense', 'NaN', '-2');
  check(
    "garbled headers → 'unknown' + nulls",
    pGarbled?.window === 'unknown' &&
      pGarbled?.remaining === null &&
      pGarbled?.resetSeconds === null,
  );
  check(
    "unrecognized window seconds → 'unknown'",
    parseRateLimitHeaders('50, 50;window=3600', '10', '5')?.window === 'unknown',
  );

  // ── Case 2: proactive throttle is a NO-OP at normal volume. ────────────────
  console.log('\nCase 2: comfortable Remaining → zero added latency across sequential calls');
  resetCase([ok(rlHeaders(MINUTE_LIMITS, 98, 3)), ok(rlHeaders(MINUTE_LIMITS, 97, 2))]);
  const r2a = await getProfile(USER_ID);
  const r2b = await getProfile(USER_ID);
  check('both requests succeeded', r2a.user_id === 1 && r2b.user_id === 1);
  check('two WHOOP hits, in order', whoopHits === 2);
  check('ZERO sleeps recorded (no throttle, no backoff)', recordedSleeps.length === 0);

  // ── Case 3: throttle sleeps until reset when Remaining <= buffer. ──────────
  console.log('\nCase 3: Remaining at/below buffer → next request waits out the reset');
  resetCase([ok(rlHeaders(MINUTE_LIMITS, 2, 3)), ok(rlHeaders(MINUTE_LIMITS, 99, 60))]);
  await getProfile(USER_ID);
  check('first call recorded no sleep', recordedSleeps.length === 0);
  await getProfile(USER_ID);
  check('second call slept once before firing', recordedSleeps.length === 1);
  check(
    `slept ≈ reset (3s): got ${recordedSleeps[0]}ms`,
    recordedSleeps[0] > 2500 && recordedSleeps[0] <= 3000,
  );
  // The observation is consumed by the wait; a fresh comfortable response means
  // a third call must NOT sleep again.
  const sleepsSoFar = recordedSleeps.length;
  await getProfile(USER_ID);
  check(
    'third call (fresh comfortable headers) did not sleep',
    recordedSleeps.length === sleepsSoFar,
  );

  // ── Case 4: day-window near-exhaustion is NOT slept on proactively. ────────
  console.log('\nCase 4: Remaining low on the DAY window → no pointless capped sleep');
  resetCase([ok(rlHeaders(DAY_LIMITS, 2, 43200)), ok(rlHeaders(MINUTE_LIMITS, 99, 60))]);
  await getProfile(USER_ID);
  await getProfile(USER_ID);
  check(
    'both fired, zero sleeps (waiting cannot refill a 24h quota)',
    whoopHits === 2 && recordedSleeps.length === 0,
  );

  // ── Case 5: minute-window 429 → retried; Retry-After wins over backoff. ────
  console.log('\nCase 5: minute-window 429 with Retry-After → retried after EXACTLY that wait');
  resetCase([
    status429(rlHeaders(MINUTE_LIMITS, 0, 7, { 'Retry-After': '7' })),
    ok(rlHeaders(MINUTE_LIMITS, 99, 60)),
  ]);
  // Huge backoff base: if the computed backoff (random jitter) were used
  // instead of Retry-After, the recorded wait would almost surely differ from
  // exactly 7000ms.
  const r5 = await getProfile(USER_ID, { backoffBaseMs: 60_000 });
  check('recovered to success', r5.user_id === 1);
  check('one retry (two hits)', whoopHits === 2);
  check(
    `slept EXACTLY Retry-After (7000ms): got ${recordedSleeps[0]}ms`,
    recordedSleeps.length === 1 && recordedSleeps[0] === 7000,
  );

  // ── Case 5b: minute-window 429 without Retry-After → computed backoff. ─────
  console.log('\nCase 5b: minute-window 429, no Retry-After → computed backoff used');
  resetCase([status429(rlHeaders(MINUTE_LIMITS, 0, 30)), ok(rlHeaders(MINUTE_LIMITS, 99, 60))]);
  const r5b = await getProfile(USER_ID, { backoffBaseMs: 4 });
  check('recovered to success', r5b.user_id === 1);
  check(
    'one backoff sleep within the jitter envelope (0..8ms)',
    recordedSleeps.length === 1 && recordedSleeps[0] >= 0 && recordedSleeps[0] <= 8,
  );

  // ── Case 6: DAY-window 429 → fail FAST, typed error, zero waits. ───────────
  console.log('\nCase 6: day-window 429 → WhoopRateLimitError immediately, no retries');
  resetCase([status429(rlHeaders(DAY_LIMITS, 0, 43200, { 'Retry-After': '30' }))]);
  const e6 = await expectThrow(() => getProfile(USER_ID));
  check('threw WhoopRateLimitError', e6 instanceof WhoopRateLimitError);
  check("window === 'day'", e6?.window === 'day');
  check(
    'carries remaining=0 / resetSeconds=43200',
    e6?.remaining === 0 && e6?.resetSeconds === 43200,
  );
  check(
    'status 429 + endpoint path only (no URL/query)',
    e6?.status === 429 && e6?.endpoint === '/v2/user/profile/basic',
  );
  check('exactly ONE fetch (zero retries burned)', whoopHits === 1);
  check('ZERO sleeps despite Retry-After present', recordedSleeps.length === 0);

  // ── Case 7: minute-window 429 exhausting the budget → typed error. ─────────
  console.log('\nCase 7: minute-window 429 forever → retries capped, then WhoopRateLimitError');
  resetCase([status429(rlHeaders(MINUTE_LIMITS, 0, 60, { 'Retry-After': '0' }))]);
  const e7 = await expectThrow(() => getProfile(USER_ID, { maxRetries: 2 }));
  check('threw WhoopRateLimitError (not generic)', e7 instanceof WhoopRateLimitError);
  check("window === 'minute'", e7?.window === 'minute');
  check('initial + 2 retries = 3 hits', whoopHits === 3);

  // ── Case 7b: 429 with NO rate-limit headers → unknown, still retried. ──────
  console.log('\nCase 7b: 429 without X-RateLimit-* headers → retried, then unknown-window error');
  resetCase([status429({ 'Retry-After': '0' })]);
  const e7b = await expectThrow(() => getProfile(USER_ID, { maxRetries: 1 }));
  check('retried once (2 hits) despite missing headers', whoopHits === 2);
  check(
    "threw WhoopRateLimitError with window 'unknown'",
    e7b instanceof WhoopRateLimitError && e7b.window === 'unknown',
  );

  // ── Case 8: unrelated retry paths unchanged. ────────────────────────────────
  console.log('\nCase 8: 5xx / network-failure / plain-4xx paths unchanged');
  resetCase([() => whoopResponse(500, { error: 'oops' }), ok(rlHeaders(MINUTE_LIMITS, 99, 60))]);
  const r8a = await getProfile(USER_ID, { backoffBaseMs: 1 });
  check('500 then 200 → retried to success', r8a.user_id === 1 && whoopHits === 2);

  resetCase(['throw', ok(rlHeaders(MINUTE_LIMITS, 99, 60))]);
  const r8b = await getProfile(USER_ID, { backoffBaseMs: 1 });
  check('network failure then 200 → retried to success', r8b.user_id === 1 && whoopHits === 2);

  resetCase([() => whoopResponse(404, { error: 'not found' })]);
  const e8c = await expectThrow(() => getProfile(USER_ID));
  check(
    'plain 404 → generic WhoopApiError, no retry, no sleep',
    e8c?.name === 'WhoopApiError' &&
      !(e8c instanceof WhoopRateLimitError) &&
      whoopHits === 1 &&
      recordedSleeps.length === 0,
  );

  resetCase([() => whoopResponse(500, { error: 'oops' })]);
  const e8d = await expectThrow(() => getProfile(USER_ID, { maxRetries: 1, backoffBaseMs: 1 }));
  check(
    'persistent 500 → still the generic WhoopApiError (not rate-limit typed)',
    e8d?.name === 'WhoopApiError' && e8d?.status === 500 && whoopHits === 2,
  );

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
