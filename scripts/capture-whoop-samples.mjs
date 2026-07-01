// scripts/capture-whoop-samples.mjs
//
// ONE-OFF capture for Phase 2.2 (deriving api/_lib/whoop-types.ts). It drives
// the REAL Phase 2.1 client (api/_lib/whoop.ts) against the REAL WHOOP API for a
// connected member and writes the RAW JSON of ONE record per endpoint to
// whoop-samples/ so the types can be derived field-by-field from a live payload
// (not from docs or memory).
//
// SECURITY / PRIVACY:
//   - whoop-samples/ contains REAL personal health data and is gitignored. This
//     script REFUSES to run if that folder is not ignored by git, so a raw
//     payload can never be written into a tracked path by accident.
//   - Like scripts/test-whoop.mjs, the CONSOLE output is safe to paste: it prints
//     only field NAMES (object keys) and record COUNTS, never field VALUES. The
//     raw values exist only inside the gitignored whoop-samples/ files.
//   - Needs real env (Supabase + WHOOP creds + encryption key), same as
//     test:whoop. Run: node --env-file=.env.local scripts/capture-whoop-samples.mjs
//
// Node 24 strips TS types but won't resolve a `.js` specifier to a sibling `.ts`,
// so we register the same tiny resolve hook test-whoop.mjs / test-refresh.mjs use
// to import the real api/_lib/*.ts module graph.

import { register } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

const OUT_DIR = fileURLToPath(new URL('../whoop-samples/', import.meta.url));

// ── Refuse to run unless whoop-samples/ is gitignored ────────────────────────
// Hard guard: never let real health data land in a tracked path.
try {
  execFileSync('git', ['check-ignore', 'whoop-samples/sample.json'], { stdio: 'pipe' });
} catch {
  console.error(
    'REFUSING TO RUN: whoop-samples/ is not gitignored. Add `whoop-samples/` to ' +
      '.gitignore before capturing real health data.',
  );
  process.exit(1);
}

// Import the REAL client after the hook is registered.
const { ENDPOINTS, getProfile, getBodyMeasurement, fetchCollectionPage } =
  await import('../api/_lib/whoop.ts');

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
console.log('Found a connected member. (user_id intentionally not printed.)\n');

mkdirSync(OUT_DIR, { recursive: true });

// Print only the SHAPE of a value: top-level keys, never values.
function describe(value) {
  if (value === null || typeof value !== 'object') {
    return typeof value;
  }
  if (Array.isArray(value)) {
    return `array[${value.length}]`;
  }
  return `object { ${Object.keys(value).join(', ')} }`;
}

function save(name, value) {
  const file = new URL(`./${name}.json`, new URL('../whoop-samples/', import.meta.url));
  writeFileSync(fileURLToPath(file), JSON.stringify(value, null, 2) + '\n');
  console.log(`  → wrote whoop-samples/${name}.json`);
}

// ── Single-object endpoints ──────────────────────────────────────────────────
async function captureObject(name, label, fn) {
  console.log(`${label}`);
  const data = await fn();
  console.log(`  shape: ${describe(data)}`);
  save(name, data);
  console.log('');
}

await captureObject('profile', 'Profile  (/v2/user/profile/basic)', () => getProfile(userId));
await captureObject('body_measurement', 'Body measurement  (/v2/user/measurement/body)', () =>
  getBodyMeasurement(userId),
);

// ── Collection endpoints: grab ONE record (limit:1, first page) ──────────────
// One record per collection is enough to derive field-by-field types; the final
// summary flags anywhere a single sample isn't enough to be sure.
async function captureOneRecord(name, label, path) {
  console.log(`${label}`);
  const page = await fetchCollectionPage(userId, path, { limit: 1 });
  if (page.records.length === 0) {
    console.log('  ⚠ no records returned in range — nothing to capture');
    save(name, { records: [], note: 'no records in default range' });
    console.log('');
    return;
  }
  const record = page.records[0];
  console.log(`  shape: ${describe(record)}`);
  save(name, record);
  console.log('');
}

await captureOneRecord('cycle', 'Cycle  (/v2/cycle)', ENDPOINTS.cycles);
await captureOneRecord('recovery', 'Recovery  (/v2/recovery)', ENDPOINTS.recovery);
await captureOneRecord('sleep', 'Sleep  (/v2/activity/sleep)', ENDPOINTS.sleep);
await captureOneRecord('workout', 'Workout  (/v2/activity/workout)', ENDPOINTS.workouts);

console.log('Done. Raw samples are in whoop-samples/ (gitignored).');
