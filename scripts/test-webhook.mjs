// scripts/test-webhook.mjs
//
// Unit test for the Phase 2.3 webhook handler (api/webhook.ts), focused on the
// `*.deleted` path added to remove cached rows when WHOOP drops a record. Like
// scripts/test-refresh.mjs (and unlike the live test-whoop smoke test), this
// mocks global `fetch` and needs NO creds and NO network: it drives the REAL
// POST handler end-to-end — through HMAC signature verification and into the
// real deleteRecord() in api/_lib/sync.ts — against an in-memory Supabase.
//
// It proves, deterministically and without a real WHOOP subscription:
//   * a valid signature + `<resource>.deleted` removes the matching cached row,
//     keyed by the CORRECT column per resource (workout/sleep UUID → whoop_id;
//     recovery → the linked sleep UUID in raw->>'sleep_id', since recovery's
//     whoop_id is the cycle_id);
//   * an invalid signature or a stale timestamp is rejected 401 and touches the
//     database NOT AT ALL;
//   * an unconfigured secret returns 501;
//   * deleting an uncached record is a no-op success (deleted=0).
//
// USAGE (from the repo root):
//   npm run test:webhook        # = node scripts/test-webhook.mjs
//
// Same .js → .ts resolve hook as scripts/test-refresh.mjs so the real
// api/_lib/*.ts module graph imports cleanly under Node 24.

import { register } from 'node:module';
import { createHmac } from 'node:crypto';

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
const SECRET = 'test-webhook-signing-secret';
process.env.WHOOP_WEBHOOK_SECRET = SECRET;
process.env.SUPABASE_URL = 'http://mock.supabase.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key';

// The handler stringifies the numeric payload `user_id`, so the cached rows are
// keyed by that string form ('123'), matching { user_id: 123 } in the payloads.
const USER_ID = '123';

// ── In-memory Supabase (PostgREST) + a fetch mock ────────────────────────────
// `store` mirrors the three deletable cache tables. The mock understands the
// PostgREST DELETE that deleteRecord() issues (…delete().eq().eq().select()):
// it removes matching rows and returns them as `return=representation` would.
const store = {
  whoop_workouts: [],
  whoop_sleep: [],
  whoop_recovery: [],
};
let supabaseCalls = 0;
let lastDelete = null;

function resetStore() {
  store.whoop_workouts = [{ user_id: USER_ID, whoop_id: 'workout-uuid-1', raw: {} }];
  store.whoop_sleep = [{ user_id: USER_ID, whoop_id: 'sleep-uuid-1', raw: {} }];
  // Recovery: whoop_id is the CYCLE id; the linked sleep UUID lives in raw.
  store.whoop_recovery = [
    { user_id: USER_ID, whoop_id: '555', raw: { cycle_id: 555, sleep_id: 'sleep-uuid-1' } },
  ];
}

function eqValue(params, key) {
  const v = params.get(key);
  return v == null ? null : v.replace(/^eq\./, '');
}

global.fetch = async (url, init = {}) => {
  const target = String(url);
  const method = (init.method || 'GET').toUpperCase();

  if (target.startsWith(process.env.SUPABASE_URL)) {
    supabaseCalls += 1;
    const u = new URL(target);
    const table = u.pathname.split('/').pop();
    const params = u.searchParams;

    if (method === 'DELETE') {
      const userId = eqValue(params, 'user_id');
      const whoopId = eqValue(params, 'whoop_id');
      // The jsonb filter key survives URL decoding as `raw->>sleep_id`.
      const sleepKey = [...params.keys()].find((k) => k.startsWith('raw'));
      const sleepId = sleepKey ? (params.get(sleepKey) || '').replace(/^eq\./, '') : null;
      lastDelete = { table, userId, whoopId, sleepId };

      const rows = store[table] || [];
      const removed = [];
      const kept = [];
      for (const r of rows) {
        const matchUser = r.user_id === userId;
        const matchId =
          whoopId != null
            ? r.whoop_id === whoopId
            : sleepId != null
              ? r.raw?.sleep_id === sleepId
              : false;
        (matchUser && matchId ? removed : kept).push(r);
      }
      store[table] = kept;
      // representation, but only the selected column — no raw payload returned.
      return new Response(JSON.stringify(removed.map((r) => ({ whoop_id: r.whoop_id }))), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Any non-DELETE Supabase call is unexpected on the delete path.
    return new Response('null', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  throw new Error(`Unexpected fetch to ${method} ${target}`);
};

// Import the REAL handler after the hook, env, and fetch mock are in place.
const { POST } = await import('../api/webhook.ts');

// ── Signed-request builder ───────────────────────────────────────────────────
function signedRequest(eventObj, opts = {}) {
  const { secret = SECRET, timestamp = String(Date.now()), signature } = opts;
  const rawBody = JSON.stringify(eventObj);
  const sig =
    signature ??
    createHmac('sha256', secret)
      .update(timestamp + rawBody)
      .digest('base64');
  return new Request('https://app.example/api/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-whoop-signature': sig,
      'x-whoop-signature-timestamp': timestamp,
    },
    body: rawBody,
  });
}

// ── Tiny assertion harness ───────────────────────────────────────────────────
let failures = 0;
function check(name, cond) {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL:'} ${name}`);
  if (!cond) failures += 1;
}

async function run() {
  // ── Case 1: workout.deleted → removes the row by whoop_id (its own key). ───
  console.log('\nCase 1: workout.deleted removes the cached workout by whoop_id');
  resetStore();
  supabaseCalls = 0;
  lastDelete = null;
  let res = await POST(
    signedRequest({ user_id: 123, id: 'workout-uuid-1', type: 'workout.deleted', trace_id: 't1' }),
  );
  let body = await res.json();
  check('HTTP 200', res.status === 200);
  check('deleted from whoop_workouts', lastDelete?.table === 'whoop_workouts');
  check('matched on whoop_id === event.id', lastDelete?.whoopId === 'workout-uuid-1');
  check('did NOT filter on raw->>sleep_id', lastDelete?.sleepId == null);
  check('response reports deleted=1', body.deleted === 1);
  check('row is gone from the store', store.whoop_workouts.length === 0);

  // ── Case 2: sleep.deleted → removes the row by whoop_id (the sleep UUID). ──
  console.log('\nCase 2: sleep.deleted removes the cached sleep by whoop_id (UUID)');
  resetStore();
  lastDelete = null;
  res = await POST(
    signedRequest({ user_id: 123, id: 'sleep-uuid-1', type: 'sleep.deleted', trace_id: 't2' }),
  );
  body = await res.json();
  check('deleted from whoop_sleep', lastDelete?.table === 'whoop_sleep');
  check('matched on whoop_id === event.id', lastDelete?.whoopId === 'sleep-uuid-1');
  check('response reports deleted=1', body.deleted === 1);
  check('row is gone from the store', store.whoop_sleep.length === 0);

  // ── Case 3: recovery.deleted → id is the SLEEP UUID; must match raw->>sleep_id.
  console.log('\nCase 3: recovery.deleted matches the linked sleep UUID in raw->>sleep_id');
  resetStore();
  lastDelete = null;
  res = await POST(
    signedRequest({ user_id: 123, id: 'sleep-uuid-1', type: 'recovery.deleted', trace_id: 't3' }),
  );
  body = await res.json();
  check('deleted from whoop_recovery', lastDelete?.table === 'whoop_recovery');
  check('did NOT filter on whoop_id (that is the cycle_id)', lastDelete?.whoopId == null);
  check('matched on raw->>sleep_id === event.id', lastDelete?.sleepId === 'sleep-uuid-1');
  check('response reports deleted=1', body.deleted === 1);
  check('row is gone from the store', store.whoop_recovery.length === 0);

  // ── Case 4: invalid signature → 401 and NO database access. ────────────────
  console.log('\nCase 4: invalid signature → 401, database untouched');
  resetStore();
  supabaseCalls = 0;
  lastDelete = null;
  res = await POST(
    signedRequest(
      { user_id: 123, id: 'workout-uuid-1', type: 'workout.deleted', trace_id: 't4' },
      { signature: 'not-a-valid-signature' },
    ),
  );
  check('HTTP 401', res.status === 401);
  check('no Supabase call was made', supabaseCalls === 0);
  check('no delete was attempted', lastDelete === null);
  check('row still present', store.whoop_workouts.length === 1);

  // ── Case 5: stale timestamp → 401 even with an otherwise-valid signature. ──
  console.log('\nCase 5: stale timestamp → 401, database untouched');
  resetStore();
  supabaseCalls = 0;
  const staleTs = String(Date.now() - 10 * 60 * 1000); // 10 min ago (> 5-min window)
  res = await POST(
    signedRequest(
      { user_id: 123, id: 'workout-uuid-1', type: 'workout.deleted', trace_id: 't5' },
      { timestamp: staleTs },
    ),
  );
  check('HTTP 401', res.status === 401);
  check('no Supabase call was made', supabaseCalls === 0);

  // ── Case 6: deleting an uncached record → success, deleted=0 (no-op). ──────
  console.log('\nCase 6: uncached record → deleted=0, still ok');
  resetStore();
  lastDelete = null;
  res = await POST(
    signedRequest({
      user_id: 123,
      id: 'workout-uuid-UNKNOWN',
      type: 'workout.deleted',
      trace_id: 't6',
    }),
  );
  body = await res.json();
  check('HTTP 200', res.status === 200);
  check('response reports deleted=0', body.deleted === 0);
  check('existing row untouched', store.whoop_workouts.length === 1);

  // ── Case 7: unconfigured signing secret → 501, database untouched. ────────
  console.log('\nCase 7: WHOOP_WEBHOOK_SECRET unset → 501');
  resetStore();
  supabaseCalls = 0;
  delete process.env.WHOOP_WEBHOOK_SECRET;
  res = await POST(
    signedRequest(
      { user_id: 123, id: 'workout-uuid-1', type: 'workout.deleted', trace_id: 't7' },
      { secret: SECRET },
    ),
  );
  check('HTTP 501', res.status === 501);
  check('no Supabase call was made', supabaseCalls === 0);
  process.env.WHOOP_WEBHOOK_SECRET = SECRET; // restore

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
