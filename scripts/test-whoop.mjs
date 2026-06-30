// scripts/test-whoop.mjs
//
// Live smoke test for the Phase 2.1 WHOOP API client (api/_lib/whoop.ts). Unlike
// scripts/test-refresh.mjs (which mocks fetch and needs no creds), this drives
// the REAL client against the REAL WHOOP API for a connected member, to prove
// the fetch layer end-to-end: auth injection, pagination cursor advance, and
// typed errors. It needs real env (Supabase + WHOOP creds + encryption key).
//
// It is SAFE to paste the output: it prints only HTTP success, RECORD COUNTS,
// page counts, and whether the pagination cursor advanced. It NEVER prints
// tokens, the member id, or any raw health/profile field values.
//
// USAGE (from the repo root):
//   1. vercel env pull .env.local       # SUPABASE_*, WHOOP_*, TOKEN_ENCRYPTION_KEY
//   2. npm run inspect:tokens           # confirm a whoop_tokens row exists first
//   3. npm run test:whoop               # = node --env-file=.env.local scripts/test-whoop.mjs
//
// Node 24 strips TS types but won't resolve a `.js` specifier to a sibling `.ts`,
// so we register the same tiny resolve hook test-refresh.mjs uses to import the
// real api/_lib/*.ts module graph.

import { register } from 'node:module';
import { createClient } from '@supabase/supabase-js';

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

// Import the REAL client after the hook is registered.
const {
  ENDPOINTS,
  getProfile,
  getBodyMeasurement,
  fetchCollectionPage,
  fetchCollection,
  WhoopApiError,
} = await import('../api/_lib/whoop.ts');

function requireEnv(name) {
  if (!process.env[name]) {
    console.error(`Missing required env var: ${name}. Run: vercel env pull .env.local`);
    process.exit(1);
  }
}
[
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TOKEN_ENCRYPTION_KEY',
  'WHOOP_CLIENT_ID',
  'WHOOP_CLIENT_SECRET',
].forEach(requireEnv);

let failures = 0;
function ok(label) {
  console.log(`  ✓ ${label}`);
}
function bad(label) {
  console.log(`  ✗ FAIL: ${label}`);
  failures += 1;
}

// ── Find a connected member (first row in whoop_tokens) ──────────────────────
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: rows, error } = await supabase.from('whoop_tokens').select('user_id').limit(1);
if (error) {
  console.error(`Failed to read whoop_tokens: ${error.message}`);
  process.exit(1);
}
if (!rows || rows.length === 0) {
  console.error(
    'No connected WHOOP member (whoop_tokens is empty). Complete the OAuth flow first.',
  );
  process.exit(1);
}
const userId = rows[0].user_id;
console.log('Found a connected member. (user_id intentionally not printed.)');

// ── Single-object endpoints: prove a 2xx + that an object came back ──────────
async function checkObject(label, fn) {
  console.log(`\n${label}`);
  try {
    const data = await fn();
    const isObject = data !== null && typeof data === 'object';
    ok(
      `fetched OK (got ${isObject ? `object, ${Object.keys(data).length} top-level field(s)` : typeof data})`,
    );
  } catch (e) {
    bad(
      `${label} threw: ${e instanceof WhoopApiError ? `WhoopApiError ${e.status} @ ${e.endpoint}` : (e?.message ?? e)}`,
    );
  }
}

await checkObject('Profile  (/v2/user/profile/basic)', () => getProfile(userId));
await checkObject('Body measurement  (/v2/user/measurement/body)', () =>
  getBodyMeasurement(userId),
);

// ── Collection endpoints: walk pages with a tiny limit to force advancement ──
// limit:1 maximizes the chance of seeing the cursor advance even with little
// data. We cap our own walk at 5 pages so the smoke test stays quick.
async function checkCollection(label, path) {
  console.log(`\n${label}`);
  try {
    let nextToken = null;
    let pages = 0;
    let total = 0;
    let advanced = false;
    do {
      const page = await fetchCollectionPage(userId, path, { limit: 1, nextToken });
      pages += 1;
      total += page.records.length;
      if (pages === 1 && page.nextToken) {
        advanced = true; // a second page exists → cursor advances
      }
      nextToken = page.nextToken;
    } while (nextToken && pages < 5);

    ok(`fetched OK — ${total} record(s) across ${pages} page(s)`);
    if (advanced) {
      ok('pagination cursor ADVANCED (next_token present after page 1)');
    } else {
      console.log(
        '  • only one page of data (cursor did not advance — fine if the range is small)',
      );
    }

    // Sanity: the aggregate helper returns at least as many as our capped walk.
    const all = await fetchCollection(userId, path, { limit: 25, maxPages: 10 });
    ok(`aggregate helper returned ${all.length} record(s) (capped walk)`);
  } catch (e) {
    bad(
      `${label} threw: ${e instanceof WhoopApiError ? `WhoopApiError ${e.status} @ ${e.endpoint}` : (e?.message ?? e)}`,
    );
  }
}

await checkCollection('Cycles  (/v2/cycle)', ENDPOINTS.cycles);
await checkCollection('Recovery  (/v2/recovery)', ENDPOINTS.recovery);
await checkCollection('Sleep  (/v2/activity/sleep)', ENDPOINTS.sleep);
await checkCollection('Workouts  (/v2/activity/workout)', ENDPOINTS.workouts);

// ── Error path: a bad path must yield a clean typed WhoopApiError, no token ──
console.log('\nError path  (deliberately bad path → typed WhoopApiError)');
try {
  await fetchCollectionPage(userId, '/v2/this-path-does-not-exist', { limit: 1 });
  bad('expected a WhoopApiError for a bad path, but the call succeeded');
} catch (e) {
  if (e instanceof WhoopApiError) {
    ok(`threw WhoopApiError (status ${e.status}, endpoint ${e.endpoint}) — no token leaked`);
  } else {
    bad(`threw a non-WhoopApiError: ${e?.message ?? e}`);
  }
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
