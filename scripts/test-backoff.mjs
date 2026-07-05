// scripts/test-backoff.mjs
//
// Unit test for the Phase 2.5 frontend retry/backoff loop
// (src/session-check.ts — the module App.tsx drives its connection state
// with). The module takes injectable fetch/sleep/isCancelled hooks precisely
// so this script can exercise the REAL retry logic deterministically: no DOM,
// no real timers, no network, and it finishes instantly.
//
// It proves:
//   * a `503 { waking:true }` response is retried with the exact capped
//     exponential schedule (WAKING_RETRY_DELAYS_MS), signalling onWaking, and
//     succeeds as soon as the server recovers;
//   * timeouts/network errors are treated as retriable too;
//   * the budget is CAPPED — an unavailable server exhausts the schedule and
//     resolves 'unreachable' (never retries forever);
//   * genuine failures (plain 500, no waking flag) resolve 'error' with ZERO
//     retries — real outages still surface immediately;
//   * a definitive 200 connected:false resolves 'disconnected' with no retry;
//   * cancellation (component unmount) stops the loop mid-wait.
//
// USAGE (from the repo root):
//   npm run test:backoff        # = node scripts/test-backoff.mjs
//
// Node 24 strips the TypeScript types on import; session-check.ts is
// framework-free so it loads without a bundler.

const { checkSessionWithRetry, WAKING_RETRY_DELAYS_MS } = await import('../src/session-check.ts');

// ── Tiny assertion harness ───────────────────────────────────────────────────
let failures = 0;
function check(name, cond) {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL:'} ${name}`);
  if (!cond) failures += 1;
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
const waking503 = () => jsonResponse(503, { connected: false, waking: true });
const connected200 = () =>
  jsonResponse(200, {
    connected: true,
    userId: 'member-123',
    scope: 'offline read:recovery',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });

/**
 * Drive checkSessionWithRetry against a scripted sequence of responses.
 * Each entry is a function returning a Response, or the string 'throw'
 * (network error / timeout). Sleeps are recorded, not waited.
 */
async function drive(sequence, { cancelAfterSleeps = Infinity } = {}) {
  let fetches = 0;
  let wakingSignals = 0;
  const sleeps = [];
  const outcome = await checkSessionWithRetry({
    fetchFn: async () => {
      const step = sequence[Math.min(fetches, sequence.length - 1)];
      fetches += 1;
      if (step === 'throw') {
        throw new TypeError('fetch failed');
      }
      return step();
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    onWaking: () => {
      wakingSignals += 1;
    },
    isCancelled: () => sleeps.length >= cancelAfterSleeps,
  });
  return { outcome, fetches, sleeps, wakingSignals };
}

async function run() {
  const maxRetries = WAKING_RETRY_DELAYS_MS.length;

  // ── Case 1: waking twice, then recovers → connected. ───────────────────────
  console.log('\nCase 1: 503 waking ×2 → 200 connected: retried, then connected');
  const c1 = await drive([waking503, waking503, connected200]);
  check('outcome connected', c1.outcome?.kind === 'connected');
  check('session metadata surfaced', c1.outcome?.session?.userId === 'member-123');
  check('fetched exactly 3 times', c1.fetches === 3);
  check(
    'slept the first two backoff delays',
    JSON.stringify(c1.sleeps) === JSON.stringify(WAKING_RETRY_DELAYS_MS.slice(0, 2)),
  );
  check('onWaking fired per retry', c1.wakingSignals === 2);

  // ── Case 2: never recovers → capped, resolves unreachable. ─────────────────
  console.log('\nCase 2: 503 waking forever → retries capped, outcome unreachable');
  const c2 = await drive([waking503]);
  check('outcome unreachable', c2.outcome?.kind === 'unreachable');
  check(
    `fetched ${maxRetries + 1} times (initial + capped retries)`,
    c2.fetches === maxRetries + 1,
  );
  check(
    'slept the full documented schedule',
    JSON.stringify(c2.sleeps) === JSON.stringify([...WAKING_RETRY_DELAYS_MS]),
  );

  // ── Case 3: network errors / timeouts are retriable too. ───────────────────
  console.log('\nCase 3: network error then recovery → retried, connected');
  const c3 = await drive(['throw', connected200]);
  check('outcome connected', c3.outcome?.kind === 'connected');
  check('retried once after the throw', c3.fetches === 2 && c3.sleeps.length === 1);

  // ── Case 4: genuine failure (plain 500, no waking flag) → NO retry. ────────
  console.log('\nCase 4: plain 500 (no waking flag) → error immediately, no retry');
  const c4 = await drive([() => jsonResponse(500, { connected: false, error: 'nope' })]);
  check('outcome error', c4.outcome?.kind === 'error');
  check('no retries, no sleeps', c4.fetches === 1 && c4.sleeps.length === 0);

  // ── Case 4b: 503 WITHOUT waking:true is also a genuine failure. ────────────
  console.log('\nCase 4b: 503 without waking:true → error, no retry');
  const c4b = await drive([() => jsonResponse(503, { connected: false })]);
  check('outcome error', c4b.outcome?.kind === 'error');
  check('no retries', c4b.fetches === 1);

  // ── Case 5: definitive disconnected → no retry. ────────────────────────────
  console.log('\nCase 5: 200 connected:false → disconnected, no retry');
  const c5 = await drive([() => jsonResponse(200, { connected: false })]);
  check('outcome disconnected', c5.outcome?.kind === 'disconnected');
  check('no retries', c5.fetches === 1 && c5.sleeps.length === 0);

  // ── Case 6: cancelled mid-wait → resolves null, loop stops. ────────────────
  console.log('\nCase 6: cancelled after the first backoff wait → null, no more fetches');
  const c6 = await drive([waking503], { cancelAfterSleeps: 1 });
  check('resolved null on cancellation', c6.outcome === null);
  check('stopped after one fetch + one sleep', c6.fetches === 1 && c6.sleeps.length === 1);

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
