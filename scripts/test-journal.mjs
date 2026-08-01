// scripts/test-journal.mjs
//
// Unit test for the Phase 5.3 journal storage endpoint, driven through the REAL
// /api/journal handler (api/journal.ts) → tokens.ts → supabase-js, with a
// mocked global `fetch` standing in for Supabase's PostgREST gateway. Like
// test-session.mjs / test-refresh.mjs: NO creds, NO network, and not a
// re-implementation of the logic under test.
//
// What it proves:
//   * AUTH: no session cookie → 401 on both verbs, and Supabase is never
//     touched (the userId can only come from the cookie, so there is nothing
//     to query without one);
//   * the request NEVER dictates the user_id — a POST body that sends its own
//     user_id is ignored and the session's id is written instead, and every
//     query filters on it;
//   * "no entry for that day" is a 200 { entry: null }, not a 404;
//   * NULL DISCIPLINE end to end: a column that is NULL in the row stays
//     `null` in the response (it does not vanish or become false/0/'none'),
//     and an answer absent from the POST payload is WRITTEN as null rather
//     than defaulted;
//   * server-side validation really is server-side: an out-of-bounds count is
//     a 400 and NO upsert is attempted;
//   * the write is an upsert on the (user_id, day) unique constraint —
//     asserted against the real on_conflict/Prefer request supabase-js emits;
//   * a malformed `day` is a 400 on both verbs;
//   * a paused/unreachable project (the documented HTTP 540, and the
//     status-0 fetch sentinel) → 503 { waking: true } + Retry-After, with no
//     internals in the body;
//   * a non-GET/POST method → 405.
//
// All fixture values are SYNTHETIC — no real personal health data.
//
// USAGE (from the repo root):
//   npm run test:journal        # = node scripts/test-journal.mjs
//
// Same .js → .ts resolve hook as the other test scripts (Node strips types
// natively but won't resolve a `.js` specifier to a sibling `.ts`).

import { register } from 'node:module';

// ── .js → .ts resolve hook (same as scripts/test-session.mjs) ───────────────
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

// ── Dummy server config (read lazily by the modules; no real secrets) ───────
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.SUPABASE_URL = 'http://mock.supabase.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key';

// ── Mock PostgREST ──────────────────────────────────────────────────────────
// Every Supabase request is recorded (decoded URL, method, headers, parsed
// body) so the assertions can inspect what the handler actually asked for —
// the on_conflict target and the written user_id are the whole point.
const calls = [];
let responder = null; // (call) => Response | throws; null = "empty table"

function normalizeHeaders(headers) {
  if (!headers) return {};
  if (typeof headers.forEach === 'function' && typeof headers.get === 'function') {
    const out = {};
    headers.forEach((value, key) => {
      out[String(key).toLowerCase()] = value;
    });
    return out;
  }
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value]),
  );
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

global.fetch = async (url, init = {}) => {
  const target = String(url);
  if (!target.startsWith(process.env.SUPABASE_URL)) {
    throw new Error(`Unexpected fetch to ${target}`);
  }
  const call = {
    method: (init.method || 'GET').toUpperCase(),
    // Decoded so assertions can read `on_conflict=user_id,day` rather than
    // its percent-encoded form.
    url: decodeURIComponent(target),
    headers: normalizeHeaders(init.headers),
    body: init.body ? JSON.parse(init.body) : null,
  };
  calls.push(call);
  const result = responder ? responder(call) : null;
  // Default: the table has no matching row (PostgREST returns an empty array).
  return result ?? jsonResponse([]);
};

// Import AFTER the mock + env are in place.
const { encodeSession } = await import('../api/_lib/tokens.ts');
const handler = (await import('../api/journal.ts')).default;

// The handler console.error()s every failure path by design; silence it so the
// test output stays readable (failures are asserted on the response instead).
console.error = () => {};

// ── Tiny assertion harness ──────────────────────────────────────────────────
let failures = 0;
function check(name, cond) {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL:'} ${name}`);
  if (!cond) failures += 1;
}

const USER_ID = 'member-123';
const OTHER_USER = 'member-999-attacker';
const DAY = '2026-07-31';

// ── Minimal stand-ins for node:http's IncomingMessage / ServerResponse ──────
/** A GET/POST request. `body`, when given, is streamed like a real request
 * (the handler reads the stream; Vercel's pre-parsed `req.body` is covered by
 * its own case below). */
function makeReq({ method = 'GET', url = '/api/journal', cookie = true, body, preParsed }) {
  const req = {
    method,
    url,
    headers: cookie ? { cookie: `whoop_session=${encodeSession(USER_ID)}` } : {},
  };
  if (preParsed !== undefined) {
    req.body = preParsed;
  }
  if (body !== undefined) {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    req[Symbol.asyncIterator] = async function* stream() {
      yield Buffer.from(raw, 'utf8');
    };
  } else {
    req[Symbol.asyncIterator] = async function* empty() {};
  }
  return req;
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
async function call(reqOptions) {
  const res = makeRes();
  await handler(makeReq(reqOptions), res);
  let json = null;
  try {
    json = JSON.parse(res.body);
  } catch {
    /* leave null */
  }
  return { status: res.statusCode, headers: res.headers, json, raw: res.body };
}

/** Reset the recorded calls and install a responder for the next case. */
function arrange(next = null) {
  calls.length = 0;
  responder = next;
}

/** The body must never leak dependency names, table names or gateway statuses. */
function leaksNothing(raw) {
  const lowered = raw.toLowerCase();
  return (
    !lowered.includes('supabase') &&
    !lowered.includes('postgrest') &&
    !lowered.includes('daily_questionnaire') &&
    !lowered.includes('540') &&
    !lowered.includes('constraint')
  );
}

// A stored row as PostgREST returns it for the selected columns: a mix of
// answered values (including an answered `0` and an answered `false`) and an
// explicit NULL, so the mapping is tested on both.
const STORED_ROW = {
  hydrated: false,
  cramps: 'moderate',
  period: 'yes',
  discharge: null, // ← explicitly NULL: must stay null in the response
  afternoon_snack: true,
  traveled: false,
  caffeine_servings: 0, // ← an answered "none", not unanswered
  alcohol_drinks: null,
  notes: 'slept badly',
  extra: { imported_from: 'test' },
};

async function run() {
  // ── Case 1: no session cookie → 401 on both verbs, DB untouched. ──────────
  console.log('\nCase 1: no session cookie → 401, Supabase never called');
  arrange();
  const g1 = await call({ url: `/api/journal?day=${DAY}`, cookie: false });
  check('GET status 401', g1.status === 401);
  check("GET error 'Not authenticated.'", g1.json?.error === 'Not authenticated.');
  const p1 = await call({
    method: 'POST',
    cookie: false,
    body: { day: DAY, answers: { period: 'yes' } },
  });
  check('POST status 401', p1.status === 401);
  check("POST error 'Not authenticated.'", p1.json?.error === 'Not authenticated.');
  check('Supabase not called at all', calls.length === 0);

  // ── Case 2: authenticated, no row for that day → 200 { entry: null }. ─────
  console.log('\nCase 2: valid session, no row for the day → 200 { entry: null }');
  arrange(); // default responder → empty array
  const g2 = await call({ url: `/api/journal?day=${DAY}` });
  check('status 200 (not 404 — "no entry yet" is normal)', g2.status === 200);
  check('entry is exactly null', g2.json?.entry === null);
  check('one Supabase read', calls.length === 1 && calls[0].method === 'GET');
  check(
    'query filtered by the SESSION user_id and the day',
    calls[0].url.includes(`user_id=eq.${USER_ID}`) && calls[0].url.includes(`day=eq.${DAY}`),
  );

  // ── Case 3: authenticated, row exists → mapped answers, nulls preserved. ──
  console.log('\nCase 3: valid session, existing row → 200 with mapped answers');
  arrange(() => jsonResponse([STORED_ROW]));
  const g3 = await call({ url: `/api/journal?day=${DAY}` });
  const e3 = g3.json?.entry;
  check('status 200', g3.status === 200);
  check("period 'yes' round-trips", e3?.period === 'yes');
  check("cramps 'moderate' round-trips", e3?.cramps === 'moderate');
  check('hydrated false stays false (not null)', e3?.hydrated === false);
  check('caffeine_servings 0 stays 0 (an answered "none")', e3?.caffeine_servings === 0);
  check('notes round-trip', e3?.notes === 'slept badly');
  check('extra jsonb round-trips', e3?.extra?.imported_from === 'test');
  // The null-discipline assertion: an explicitly-NULL column must arrive as a
  // present key whose value is null — not missing, not false, not 'none'.
  check(
    'NULL discharge is present and null (key not dropped)',
    'discharge' in (e3 ?? {}) && e3.discharge === null,
  );
  check(
    'NULL alcohol_drinks is present and null (not 0)',
    'alcohol_drinks' in (e3 ?? {}) && e3.alcohol_drinks === null,
  );
  check(
    'no id/user_id/day/timestamps leaked into the body',
    !('id' in (e3 ?? {})) &&
      !('user_id' in (e3 ?? {})) &&
      !('day' in (e3 ?? {})) &&
      !('created_at' in (e3 ?? {})) &&
      !('updated_at' in (e3 ?? {})),
  );

  // ── Case 4: out-of-bounds value → 400 and NOTHING written. ────────────────
  console.log('\nCase 4: POST alcohol_drinks above the max → 400, no upsert attempted');
  arrange(() => {
    throw new Error('Supabase must not be called for an invalid payload');
  });
  const p4 = await call({
    method: 'POST',
    // ALCOHOL_DRINKS_MAX is 30 (journal-types.ts / the 0004 CHECK).
    body: { day: DAY, answers: { alcohol_drinks: 31 } },
  });
  check('status 400', p4.status === 400);
  check('generic error body', p4.json?.error === 'Invalid request.');
  check('NO Supabase call was made', calls.length === 0);

  // Same guard for the other rule families the DB CHECKs enforce.
  arrange(() => {
    throw new Error('Supabase must not be called for an invalid payload');
  });
  const p4b = await call({
    method: 'POST',
    body: { day: DAY, answers: { period: 'maybe' } },
  });
  check('period outside the vocabulary → 400, no write', p4b.status === 400 && calls.length === 0);
  arrange(() => {
    throw new Error('Supabase must not be called for an invalid payload');
  });
  const p4c = await call({
    method: 'POST',
    body: { day: DAY, answers: { caffeine_servings: 1.5 } },
  });
  check('non-integer count → 400, no write', p4c.status === 400 && calls.length === 0);
  arrange(() => {
    throw new Error('Supabase must not be called for an invalid payload');
  });
  const p4d = await call({
    method: 'POST',
    body: { day: DAY, answers: { hydrated: 'yes' } },
  });
  check('wrong-typed boolean → 400, no write', p4d.status === 400 && calls.length === 0);

  // ── Case 5: valid POST → upsert on (user_id, day), session's user_id. ─────
  console.log('\nCase 5: valid POST → upsert on (user_id, day) with the SESSION user_id');
  const saved = {
    hydrated: null,
    cramps: null,
    period: 'yes',
    discharge: null,
    afternoon_snack: null,
    traveled: null,
    caffeine_servings: 0,
    alcohol_drinks: null,
    notes: null,
    extra: null,
  };
  arrange(() => jsonResponse([saved]));
  const p5 = await call({
    method: 'POST',
    body: {
      day: DAY,
      // The body TRIES to write someone else's row — both at the top level and
      // inside answers. Neither may be honoured.
      user_id: OTHER_USER,
      answers: { period: 'yes', caffeine_servings: 0, user_id: OTHER_USER },
    },
  });
  check('status 200', p5.status === 200);
  check('one Supabase call', calls.length === 1);
  const write = calls[0] ?? { url: '', headers: {}, body: null };
  check('written as a POST (PostgREST upsert)', write.method === 'POST');
  check("on_conflict targets 'user_id,day'", write.url.includes('on_conflict=user_id,day'));
  check(
    'Prefer: resolution=merge-duplicates (upsert, not insert)',
    String(write.headers.prefer ?? '').includes('merge-duplicates'),
  );
  check('row.user_id is the SESSION id', write.body?.user_id === USER_ID);
  check('row.user_id is NOT the id from the body', write.body?.user_id !== OTHER_USER);
  check('row.day is the requested day', write.body?.day === DAY);
  check('updated_at stamped by the write path', typeof write.body?.updated_at === 'string');
  // Null discipline on the WRITE side: unanswered questions are written as
  // explicit nulls, never omitted-and-defaulted or coerced to false/0/'none'.
  check(
    'unanswered fields written as explicit null',
    write.body?.hydrated === null &&
      write.body?.cramps === null &&
      write.body?.traveled === null &&
      write.body?.alcohol_drinks === null &&
      write.body?.discharge === null,
  );
  check('answered 0 written as 0, not null', write.body?.caffeine_servings === 0);
  check("answered period written as 'yes'", write.body?.period === 'yes');
  check('response echoes the saved row', p5.json?.entry?.period === 'yes');
  check('response keeps nulls null', p5.json?.entry?.discharge === null);

  // Vercel's Node runtime may hand the body over pre-parsed instead of as a
  // stream; the same request must behave identically.
  console.log('  (same payload, pre-parsed req.body — Vercel runtime shape)');
  arrange(() => jsonResponse([saved]));
  const p5b = await call({
    method: 'POST',
    preParsed: { day: DAY, answers: { period: 'yes', caffeine_servings: 0 } },
  });
  check(
    'pre-parsed body → same 200 + same upsert target',
    p5b.status === 200 &&
      calls.length === 1 &&
      calls[0].url.includes('on_conflict=user_id,day') &&
      calls[0].body?.user_id === USER_ID,
  );

  // ── Case 6: malformed day → 400 on both verbs, nothing queried. ───────────
  console.log('\nCase 6: malformed / missing day → 400 on both verbs');
  arrange(() => {
    throw new Error('Supabase must not be called for an invalid day');
  });
  const g6a = await call({ url: '/api/journal?day=31-07-2026' });
  check('GET wrong format → 400', g6a.status === 400);
  const g6b = await call({ url: '/api/journal' });
  check('GET missing day → 400', g6b.status === 400);
  const g6c = await call({ url: '/api/journal?day=2026-13-45' });
  check('GET impossible calendar date → 400', g6c.status === 400);
  const p6 = await call({
    method: 'POST',
    body: { day: '2026-7-1', answers: { period: 'no' } },
  });
  check('POST unpadded day → 400', p6.status === 400);
  const p6b = await call({ method: 'POST', body: { answers: { period: 'no' } } });
  check('POST missing day → 400', p6b.status === 400);
  const p6c = await call({ method: 'POST', body: { day: DAY } });
  check('POST missing answers → 400', p6c.status === 400);
  check('no Supabase call for any malformed request', calls.length === 0);

  // ── Case 7: paused / unreachable project → 503 waking. ────────────────────
  console.log('\nCase 7: paused project (documented HTTP 540) → 503 { waking: true }');
  arrange(() => jsonResponse({ message: 'Project paused' }, 540));
  const g7 = await call({ url: `/api/journal?day=${DAY}` });
  check('GET status 503', g7.status === 503);
  check('GET waking:true', g7.json?.waking === true);
  check('GET Retry-After header set', g7.headers['retry-after'] === '5');
  check('GET leaks no internals', leaksNothing(g7.raw));

  arrange(() => jsonResponse({ message: 'Project paused' }, 540));
  const p7 = await call({
    method: 'POST',
    body: { day: DAY, answers: { period: 'yes' } },
  });
  check('POST status 503', p7.status === 503);
  check('POST waking:true', p7.json?.waking === true);
  check('POST Retry-After header set', p7.headers['retry-after'] === '5');
  check('POST leaks no internals', leaksNothing(p7.raw));

  console.log('\nCase 8: gateway 503 and a genuine PostgREST 500');
  arrange(() => jsonResponse({ message: 'service unavailable' }, 503));
  const g8 = await call({ url: `/api/journal?day=${DAY}` });
  check('gateway 503 → 503 waking', g8.status === 503 && g8.json?.waking === true);

  arrange(() => jsonResponse({ message: 'internal error', code: 'XX000' }, 500));
  const g8b = await call({ url: `/api/journal?day=${DAY}` });
  check('PostgREST 500 → flat 500, NOT waking', g8b.status === 500 && !('waking' in g8b.json));
  check('generic read error message', g8b.json?.error === 'Failed to load journal entry.');
  check('read error leaks no internals', leaksNothing(g8b.raw));

  arrange(() => jsonResponse({ message: 'internal error', code: 'XX000' }, 500));
  const p8 = await call({
    method: 'POST',
    body: { day: DAY, answers: { period: 'yes' } },
  });
  check('write failure → flat 500', p8.status === 500 && !('waking' in p8.json));
  check('generic write error message', p8.json?.error === 'Failed to save journal entry.');
  check('write error leaks no internals', leaksNothing(p8.raw));

  // ── Case 9: wrong method → 405. ───────────────────────────────────────────
  console.log('\nCase 9: method other than GET/POST → 405');
  arrange(() => {
    throw new Error('Supabase must not be called for a rejected method');
  });
  const d9 = await call({ method: 'DELETE', url: `/api/journal?day=${DAY}` });
  check('status 405', d9.status === 405);
  check("error 'Method not allowed.'", d9.json?.error === 'Method not allowed.');
  check('Allow header lists GET, POST', d9.headers.allow === 'GET, POST');
  check('no Supabase call', calls.length === 0);

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => {
  // console.error is stubbed; use log so real harness failures still print.
  console.log('UNEXPECTED TEST HARNESS FAILURE:', e);
  process.exit(1);
});
