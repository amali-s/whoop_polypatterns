// scripts/sync-whoop.mjs
//
// Manual/backfill trigger for the Phase 2.3 sync layer (api/_lib/sync.ts). Drives
// the REAL sync against the REAL WHOOP API + Supabase for every connected member,
// so the human can seed the cache with a wide history window once, locally,
// without waiting for the daily cron. Needs real env (Supabase + WHOOP creds +
// encryption key), same as scripts/test-whoop.mjs.
//
// It is SAFE to paste the output: it prints only RECORD COUNTS per resource
// (fetched / upserted / skipped / errored) and whether re-auth is required. It
// NEVER prints tokens, the member id, or any raw health field values.
//
// USAGE (from the repo root):
//   1. vercel env pull .env.local          # SUPABASE_*, WHOOP_*, TOKEN_ENCRYPTION_KEY
//   2. npm run inspect:tokens              # confirm a whoop_tokens row exists first
//   3. npm run sync:whoop                  # backfill the default 90-day window
//      npm run sync:whoop -- --days 365    # wider backfill
//      npm run sync:whoop -- --days 7      # incremental (what the cron does)
//
// (Or trigger the deployed/`vercel dev` endpoint instead — see README notes and
//  the curl commands in the Phase 2.3 handoff.)
//
// Node 24 strips TS types but won't resolve a `.js` specifier to a sibling `.ts`,
// so we register the same tiny resolve hook test-whoop.mjs uses.

import { register } from 'node:module';
import { createClient } from '@supabase/supabase-js';

// ── .js → .ts resolve hook (same as scripts/test-whoop.mjs) ──────────────────
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

// Import the REAL sync layer after the hook is registered.
const { syncAll } = await import('../api/_lib/sync.ts');

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

// ── CLI args: --days N (default 90 for a backfill) ───────────────────────────
function parseDays() {
  const idx = process.argv.indexOf('--days');
  if (idx !== -1 && process.argv[idx + 1]) {
    const n = Number(process.argv[idx + 1]);
    if (Number.isFinite(n) && n > 0) {
      return Math.trunc(n);
    }
  }
  return 90;
}
const lookbackDays = parseDays();

// ── Find connected members (all rows in whoop_tokens) ────────────────────────
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: rows, error } = await supabase.from('whoop_tokens').select('user_id');
if (error) {
  console.error(`Failed to read whoop_tokens: ${error.message}`);
  process.exit(1);
}
if (!rows || rows.length === 0) {
  console.error('No connected WHOOP member (whoop_tokens is empty). Complete the OAuth flow first.');
  process.exit(1);
}

console.log(`Backfilling ${rows.length} member(s) over the last ${lookbackDays} day(s).`);
console.log('(user_id intentionally not printed.)\n');

let hadError = false;
for (const { user_id: userId } of rows) {
  const summary = await syncAll(userId, { lookbackDays });
  console.log(`window ${summary.window.start} → ${summary.window.end}`);
  if (summary.reauthRequired) {
    console.log('  ⚠ RE-AUTH REQUIRED (WHOOP rejected the token) — reconnect this member.');
    hadError = true;
  }
  for (const r of summary.results) {
    const suffix = r.error ? `  [error: ${r.error}]` : '';
    console.log(
      `  ${r.resource.padEnd(9)} fetched=${r.fetched} upserted=${r.upserted} ` +
        `skipped=${r.skipped} deduped=${r.deduped} errored=${r.errored}${suffix}`,
    );
    if (r.error || r.errored > 0) {
      hadError = true;
    }
  }
  console.log('');
}

console.log(hadError ? 'DONE WITH ERRORS (see above)' : 'DONE — cache seeded');
process.exit(hadError ? 1 : 0);
