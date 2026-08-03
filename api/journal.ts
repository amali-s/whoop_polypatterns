// GET  /api/journal?day=YYYY-MM-DD              — read one day's journal entry
// GET  /api/journal?from=YYYY-MM-DD&to=YYYY-MM-DD — read a DAY/PERIOD range
// POST /api/journal { day, answers }             — create/replace that day's entry
//
// The storage half of Phase 5 (5.3): the daily questionnaire's read/write path
// against `public.daily_questionnaire` (0004), keyed by (user_id, day). The
// table carries `unique (user_id, day)`, so this is an EDIT-TODAY workflow —
// one row per day, written with an upsert on that pair — not an append-only
// log. Nothing here creates a schema: 0004 is already applied to production.
//
// SECURITY (mirrors /api/sleep-stages' posture):
//   - The member is identified ONLY by the HttpOnly whoop_session cookie. The
//     `user_id` written to (and filtered on) is derived server-side from that
//     cookie and NEVER read from the body or query string — a body that sends
//     its own user_id is ignored, not honoured.
//   - The service-role client bypasses RLS, so that filtering is the only
//     thing standing between two members' rows. It is applied on every path.
//   - On failure the body is generic: no Supabase messages, status codes or
//     dependency names leave the server. Details go to console.error.
//
// NULL DISCIPLINE (the reason validation is hand-written rather than a coerce):
//   Every answer column is nullable and NULL means NOT ANSWERED — never false,
//   never 0, never 'none' (journal-types.ts's header; src/lib/cycle.ts for what
//   a fabricated `period: 'no'` would do to cycle detection). So: an absent or
//   null field is written as NULL, no field is ever defaulted, and a value of
//   the wrong TYPE is a 400 rather than something coerced into a shape the DB
//   would accept. The form validates client-side already; this does not trust it.
//
// THE RANGE READ (Phase 5.7 — closing the period-meter seam):
//   `?from=&to=` is a SECOND, deliberately narrow GET shape: it returns
//   `{ day, period }` and nothing else, because its consumer is the cycle-day
//   dot matrix (src/hooks/usePeriodLogs.ts → src/lib/cycle.ts), which needs
//   HISTORY — `cycleState` recomputes episodes from the whole log every time by
//   design. The form's single-day read still gets ANSWER_SELECT; a chart has no
//   business receiving the user's notes, cramps and discharge as well.
//
//   Named `from`/`to` rather than `?days=N` ON PURPOSE: the single-day param is
//   `?day=`, and a `day` vs. `days` pair differing by one letter is a footgun
//   where a typo silently changes which contract you get. The two shapes are
//   ROUTED on which params are present and MIXING them is a 400, so a request
//   is never quietly reinterpreted as the other kind.
//
//   The span is capped server-side (MAX_RANGE_DAYS) so the endpoint can't be
//   turned into an unbounded history dump, and rows for days that were never
//   logged are simply ABSENT — no placeholder days are synthesized (unlike
//   /api/daily-series, which emits a point per day for axis continuity). A
//   stored NULL `period` serializes as `null`, never 'no': the tri-state is the
//   0004 migration's hard constraint and cycle.ts reads the difference.
//
// Responses (always JSON):
//   200 { entry: JournalAnswers | null }        — GET ?day=; `null` = no entry
//       for that day yet, which is a normal state, not a 404
//   200 { days: [{ day, period }] }             — GET ?from=&to=; ascending by
//       day, only days that have a row, `period` may be null
//   200 { entry: JournalAnswers }               — POST; the row as saved
//   400 { error: 'Invalid request.' }           — bad/absent day, bad answers,
//       bad/inverted/over-long range, or `day` mixed with `from`/`to`
//   401 { error: 'Not authenticated.' }         — no/invalid session cookie
//   405 { error: 'Method not allowed.' }        — not GET or POST
//   503 { waking: true } (+ Retry-After)        — database unavailable, likely
//       the paused/waking free-tier Supabase project (Phase 2.5)
//   500 { error: 'Failed to load journal entry.' | 'Failed to load journal history.'
//              | 'Failed to save journal entry.' }

import type { IncomingMessage, ServerResponse } from 'node:http';
import { SESSION_COOKIE, decodeSession } from './_lib/tokens.js';
import {
  DatabaseUnavailableError,
  getSupabaseAdmin,
  isDbUnavailableStatus,
} from './_lib/supabase.js';
import {
  ALCOHOL_DRINKS_MAX,
  ALCOHOL_DRINKS_MIN,
  CAFFEINE_SERVINGS_MAX,
  CAFFEINE_SERVINGS_MIN,
  CRAMP_LEVELS,
  DISCHARGE_LEVELS,
  type CrampLevel,
  type DischargeLevel,
  type JournalAnswers,
  type PeriodAnswer,
} from './_lib/journal-types.js';

const TABLE = 'daily_questionnaire';

/** Exactly the JournalAnswers keys — so a selected row maps to the response
 * shape with no field to forget, and id/created_at/updated_at (which the form
 * never uses) stay server-side. */
const ANSWER_COLUMNS = [
  'hydrated',
  'cramps',
  'period',
  'discharge',
  'afternoon_snack',
  'traveled',
  'caffeine_servings',
  'alcohol_drinks',
  'notes',
  'extra',
] as const;

const ANSWER_SELECT = ANSWER_COLUMNS.join(', ');

/** The range read's projection — the two columns the cycle-day meter needs and
 * no more (see THE RANGE READ in the header). Deliberately NOT ANSWER_SELECT. */
const PERIOD_SELECT = 'day, period';

/** Widest `from`→`to` span accepted, in days (inclusive of both bounds). A
 * ceiling, not the client's window: usePeriodLogs asks for 100. It exists so a
 * hand-made request can't ask for every row the member has ever written. */
const MAX_RANGE_DAYS = 400;

/** Largest JSON body accepted, in bytes. `notes` is free text and `extra` is
 * an untyped jsonb escape hatch, so the payload needs a ceiling that isn't the
 * platform's; 64 KB is far past any plausible day's entry. */
const MAX_BODY_BYTES = 64 * 1024;

/** Parse the request's Cookie header into a name→value map (matches session.ts). */
function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) {
    return out;
  }
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      continue;
    }
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) {
      out[name] = decodeURIComponent(value);
    }
  }
  return out;
}

/** End with a JSON body at the given status. */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/**
 * True for a real ISO calendar day. The shape check alone would accept
 * '2026-13-45'; the round-trip rejects it, because `day` is a primary lookup
 * key and a nonsense one would silently read/write nothing.
 */
function isValidDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Inclusive day count from `from` to `to` — 1 when they are the same day.
 * Both arguments have passed `isValidDay`, so the UTC parse is exact: UTC has
 * no DST, every day is 86_400_000 ms, and the division cannot truncate off by
 * one the way local-midnight Dates do (src/lib/cycle.ts's `dayNumber`).
 * Negative when the range is inverted, which the caller rejects.
 */
function spanDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return (end - start) / 86_400_000 + 1;
}

/**
 * Read and JSON-parse the request body.
 *
 * Vercel's Node runtime may already have parsed the body onto `req.body` (in
 * which case the stream is spent), and the local test harness passes a plain
 * stream — so handle both rather than assuming either.
 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const preParsed = (req as IncomingMessage & { body?: unknown }).body;
  if (preParsed !== undefined && preParsed !== null) {
    if (typeof preParsed === 'string') {
      return preParsed === '' ? null : (JSON.parse(preParsed) as unknown);
    }
    if (Buffer.isBuffer(preParsed)) {
      return JSON.parse(preParsed.toString('utf8')) as unknown;
    }
    return preParsed;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buf.byteLength;
    if (size > MAX_BODY_BYTES) {
      throw new Error('Request body too large.');
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw === '' ? null : (JSON.parse(raw) as unknown);
}

// ── Per-field validation ────────────────────────────────────────────────────
// Each helper returns the validated value, `null` for "not answered", or the
// INVALID sentinel — deliberately distinct from `null`, so "the client sent
// garbage" (400) can never be mistaken for "the user didn't answer" (a NULL
// column). `undefined` and `null` are the same input here: field absent.

const INVALID = Symbol('invalid');
type Checked<T> = T | null | typeof INVALID;

function checkBoolean(value: unknown): Checked<boolean> {
  if (value === undefined || value === null) {
    return null;
  }
  return typeof value === 'boolean' ? value : INVALID;
}

/** Membership in one of the closed vocabularies (the 0004 CHECK constraints). */
function checkEnum<T extends string>(value: unknown, allowed: readonly T[]): Checked<T> {
  if (value === undefined || value === null) {
    return null;
  }
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : INVALID;
}

/** An integer count inside its bounds. `0` is an answered "none", so it must
 * survive — only `undefined`/`null` mean unanswered. */
function checkCount(value: unknown, min: number, max: number): Checked<number> {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    return INVALID;
  }
  return value;
}

function checkNotes(value: unknown): Checked<string> {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    return INVALID;
  }
  const trimmed = value.trim();
  // '' is not an answer; storing it would make "wrote nothing" look different
  // from "never typed", which it isn't.
  return trimmed === '' ? null : trimmed;
}

function checkExtra(value: unknown): Checked<Record<string, unknown>> {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return INVALID;
  }
  return value as Record<string, unknown>;
}

const PERIOD_ANSWERS: readonly PeriodAnswer[] = ['yes', 'no'];

/**
 * Validate a POSTed `answers` object into a complete `JournalAnswers`, or
 * `null` if anything about it is wrong. Every one of the ten keys is written
 * explicitly, so an unknown key in the payload is ignored rather than reaching
 * the table, and an absent key becomes NULL rather than a default.
 */
function parseAnswers(input: unknown): JournalAnswers | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return null;
  }
  const raw = input as Record<string, unknown>;

  const hydrated = checkBoolean(raw.hydrated);
  const cramps = checkEnum<CrampLevel>(raw.cramps, CRAMP_LEVELS);
  const period = checkEnum<PeriodAnswer>(raw.period, PERIOD_ANSWERS);
  const discharge = checkEnum<DischargeLevel>(raw.discharge, DISCHARGE_LEVELS);
  const afternoonSnack = checkBoolean(raw.afternoon_snack);
  const traveled = checkBoolean(raw.traveled);
  const caffeine = checkCount(raw.caffeine_servings, CAFFEINE_SERVINGS_MIN, CAFFEINE_SERVINGS_MAX);
  const alcohol = checkCount(raw.alcohol_drinks, ALCOHOL_DRINKS_MIN, ALCOHOL_DRINKS_MAX);
  const notes = checkNotes(raw.notes);
  const extra = checkExtra(raw.extra);

  const checked = [
    hydrated,
    cramps,
    period,
    discharge,
    afternoonSnack,
    traveled,
    caffeine,
    alcohol,
    notes,
    extra,
  ];
  if (checked.some((value) => value === INVALID)) {
    return null;
  }

  return {
    hydrated: hydrated as boolean | null,
    cramps: cramps as CrampLevel | null,
    period: period as PeriodAnswer | null,
    discharge: discharge as DischargeLevel | null,
    afternoon_snack: afternoonSnack as boolean | null,
    traveled: traveled as boolean | null,
    caffeine_servings: caffeine as number | null,
    alcohol_drinks: alcohol as number | null,
    notes: notes as string | null,
    extra: extra as Record<string, unknown> | null,
  };
}

/**
 * Project a selected row onto the response shape. Written key by key (rather
 * than spread) so id/user_id/day/timestamps cannot leak, and so a column that
 * came back NULL stays `null` in the body instead of disappearing — the form
 * distinguishes "absent" from "answered none".
 */
function toAnswers(row: Record<string, unknown>): JournalAnswers {
  return {
    hydrated: (row.hydrated ?? null) as boolean | null,
    cramps: (row.cramps ?? null) as CrampLevel | null,
    period: (row.period ?? null) as PeriodAnswer | null,
    discharge: (row.discharge ?? null) as DischargeLevel | null,
    afternoon_snack: (row.afternoon_snack ?? null) as boolean | null,
    traveled: (row.traveled ?? null) as boolean | null,
    caffeine_servings: (row.caffeine_servings ?? null) as number | null,
    alcohol_drinks: (row.alcohol_drinks ?? null) as number | null,
    notes: (row.notes ?? null) as string | null,
    extra: (row.extra ?? null) as Record<string, unknown> | null,
  };
}

/** One day of period history as the range read serializes it. */
interface PeriodDay {
  day: string;
  /** Tri-state, preserved verbatim: `null` = NOT LOGGED, never 'no'. */
  period: PeriodAnswer | null;
}

/**
 * Project a `PERIOD_SELECT` row onto the response shape. `period` passes
 * through untouched apart from `undefined` → `null` (a column PostgREST
 * omitted): the one transformation this function must NEVER do is turn a NULL
 * into 'no' — see the tri-state section of 0004's header and PeriodAnswer in
 * journal-types.ts.
 */
function toPeriodDay(row: Record<string, unknown>): PeriodDay {
  return {
    day: String(row.day),
    period: (row.period ?? null) as PeriodAnswer | null,
  };
}

/**
 * GET ?from=&to= — the member's `{ day, period }` rows across an inclusive
 * date range, ascending. Days with no row are ABSENT from the array (the
 * caller's cycle detection treats "not logged" and "logged 'no'" identically,
 * so a synthesized placeholder would add nothing but a lie about what was
 * asked). Index: `unique (user_id, day)` from 0001 already gives this scan its
 * btree on `(user_id, day)` — no migration was needed for this endpoint.
 */
async function handleRange(
  res: ServerResponse,
  userId: string,
  from: string,
  to: string,
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error, status } = await supabase
      .from(TABLE)
      .select(PERIOD_SELECT)
      // user_id comes from the session cookie, never the request.
      .eq('user_id', userId)
      .gte('day', from)
      .lte('day', to)
      .order('day', { ascending: true });

    if (error) {
      if (isDbUnavailableStatus(status)) {
        throw new DatabaseUnavailableError(status);
      }
      throw new Error(`Failed to read ${TABLE}: ${error.message}`);
    }

    // Same cast caveat as the single-day read: PERIOD_SELECT names exactly
    // these two columns, which the untyped client can't prove.
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    json(res, 200, { days: rows.map(toPeriodDay) });
  } catch (err) {
    if (err instanceof DatabaseUnavailableError) {
      console.error(`Journal history read: database unavailable (status ${err.status}).`);
      res.setHeader('Retry-After', '5');
      json(res, 503, { waking: true });
      return;
    }
    console.error('Journal history read failed:', err);
    json(res, 500, { error: 'Failed to load journal history.' });
  }
}

/**
 * GET — routed on WHICH params are present, never on their values: `day` alone
 * is the form's single-day read, `from`+`to` is the range read, and anything
 * else (both kinds at once, half a range, neither) is a 400 rather than a
 * guess. See THE RANGE READ in the header for why the names differ this much.
 */
async function handleGet(req: IncomingMessage, res: ServerResponse, userId: string): Promise<void> {
  const url = new URL(req.url ?? '', 'http://localhost');
  const day = url.searchParams.get('day');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const wantsRange = from !== null || to !== null;
  if (day !== null && wantsRange) {
    // `day` and `days`-style params one letter apart is exactly the confusion
    // this endpoint refuses to resolve silently.
    json(res, 400, { error: 'Invalid request.' });
    return;
  }
  if (wantsRange) {
    if (!isValidDay(from) || !isValidDay(to)) {
      json(res, 400, { error: 'Invalid request.' });
      return;
    }
    const span = spanDays(from, to);
    // Inverted (`to` before `from`) and over-long spans are both malformed
    // requests, not empty results — the cap is what keeps this from being an
    // unbounded history dump.
    if (span < 1 || span > MAX_RANGE_DAYS) {
      json(res, 400, { error: 'Invalid request.' });
      return;
    }
    await handleRange(res, userId, from, to);
    return;
  }

  if (!isValidDay(day)) {
    json(res, 400, { error: 'Invalid request.' });
    return;
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error, status } = await supabase
      .from(TABLE)
      .select(ANSWER_SELECT)
      // user_id comes from the session cookie, never the request.
      .eq('user_id', userId)
      .eq('day', day)
      // `unique (user_id, day)` guarantees at most one; limit(1) keeps the
      // response a plain array (no single()/maybeSingle() error semantics to
      // reinterpret) and "no row" stays an ordinary empty result.
      .limit(1);

    if (error) {
      if (isDbUnavailableStatus(status)) {
        throw new DatabaseUnavailableError(status);
      }
      throw new Error(`Failed to read ${TABLE}: ${error.message}`);
    }

    // ANSWER_SELECT names exactly the answer columns — the untyped client
    // can't prove that, hence the cast (the sleep-stages.ts precedent).
    const row = ((data ?? []) as unknown as Record<string, unknown>[])[0];
    // No row is a NORMAL state ("no entry yet"), not a 404.
    json(res, 200, { entry: row ? toAnswers(row) : null });
  } catch (err) {
    if (err instanceof DatabaseUnavailableError) {
      console.error(`Journal read: database unavailable (status ${err.status}).`);
      res.setHeader('Retry-After', '5');
      json(res, 503, { waking: true });
      return;
    }
    console.error('Journal read failed:', err);
    json(res, 500, { error: 'Failed to load journal entry.' });
  }
}

/** POST — upsert the day's entry on `(user_id, day)`. */
async function handlePost(
  req: IncomingMessage,
  res: ServerResponse,
  userId: string,
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    json(res, 400, { error: 'Invalid request.' });
    return;
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    json(res, 400, { error: 'Invalid request.' });
    return;
  }
  const { day, answers } = body as { day?: unknown; answers?: unknown };
  if (!isValidDay(day)) {
    json(res, 400, { error: 'Invalid request.' });
    return;
  }
  // Re-validated server-side even though the form checks the same bounds — the
  // API is reachable without the form. The body is not told WHICH rule it
  // broke; the form already prevents every reachable case.
  const parsed = parseAnswers(answers);
  if (!parsed) {
    json(res, 400, { error: 'Invalid request.' });
    return;
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error, status } = await supabase
      .from(TABLE)
      .upsert(
        {
          // The session's member, always. Any user_id in the payload was
          // dropped by parseAnswers and is not consulted here.
          user_id: userId,
          day,
          ...parsed,
          // 0004 has no updated_at trigger (0001's convention) — the write
          // path stamps it.
          updated_at: new Date().toISOString(),
        },
        // The `unique (user_id, day)` constraint: a second save for the same
        // day EDITS that row instead of failing or appending.
        { onConflict: 'user_id,day' },
      )
      .select(ANSWER_SELECT);

    if (error) {
      if (isDbUnavailableStatus(status)) {
        throw new DatabaseUnavailableError(status);
      }
      throw new Error(`Failed to upsert ${TABLE}: ${error.message}`);
    }

    // Same cast as the read path: the representation is ANSWER_SELECT's columns.
    const row = ((data ?? []) as unknown as Record<string, unknown>[])[0];
    // Echo the row as SAVED where the write returned it; fall back to the
    // validated payload only if the representation is missing, so the client
    // still sees exactly what was written.
    json(res, 200, { entry: row ? toAnswers(row) : parsed });
  } catch (err) {
    if (err instanceof DatabaseUnavailableError) {
      console.error(`Journal write: database unavailable (status ${err.status}).`);
      res.setHeader('Retry-After', '5');
      json(res, 503, { waking: true });
      return;
    }
    console.error('Journal write failed:', err);
    json(res, 500, { error: 'Failed to save journal entry.' });
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    json(res, 405, { error: 'Method not allowed.' });
    return;
  }

  // Identity comes from the opaque session cookie alone (same as /api/session
  // and /api/sleep-stages): this endpoint reads and writes one member's rows,
  // so "who" is required and a missing/tampered cookie is a 401.
  const cookies = parseCookies(req.headers.cookie);
  const userId = decodeSession(cookies[SESSION_COOKIE]);
  if (!userId) {
    json(res, 401, { error: 'Not authenticated.' });
    return;
  }

  if (method === 'GET') {
    await handleGet(req, res, userId);
    return;
  }
  await handlePost(req, res, userId);
}
