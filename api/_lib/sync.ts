// Server-only sync writer (Phase 2.3 — the caching layer).
//
// This module is the bridge from the WHOOP fetch layer (api/_lib/whoop.ts,
// Phase 2.1/2.2) to our Postgres cache (supabase/migrations/0001_init.sql). It
// pulls a date window of each resource and UPSERTs one row per record so the
// dashboard reads OUR database, not the WHOOP API on every page load.
//
// SECURITY / IMPORT CONTRACT:
//   - Server-only. It composes whoop.ts (token refresh) and supabase.ts (the
//     service-role client that BYPASSES RLS), so it must NEVER be imported into
//     /src — same contract as crypto.ts / supabase.ts / whoop.ts.
//   - We log COUNTS ONLY. No token material and no raw health fields ever go to
//     a log line — the full payload is written to the `raw jsonb` column and
//     nowhere else. Resource-level error strings carry an HTTP status at most.
//
// CONCURRENCY / TOKEN REFRESH: every fetch here is issued SEQUENTIALLY (never in
//   parallel). WHOOP rotates refresh tokens (one-time use — see refresh.ts), so
//   two concurrent requests on an expired token would both try to refresh and the
//   loser gets a spurious 400. Sequencing means the first request refreshes once
//   and the rest reuse the fresh token. This is also why syncAll fetches each
//   collection ONCE and threads the cycle/sleep day maps into recovery rather
//   than re-fetching.
//
// WHAT GOES IN `raw`: the ENTIRE WHOOP record object, verbatim. Since Phase 2.4
// (supabase/migrations/0003_typed_columns.sql) each row ALSO carries typed
// columns for the fields the Phase 4 charts read — populated here from the same
// record object. `raw` remains the source of truth; the typed columns are a
// read optimization. Score-derived columns are written NULL unless
// score_state === 'SCORED' (WHOOP returns score: null in the other states —
// we never guess or default them).
//
// ── HOW `day` IS DERIVED PER RESOURCE (read off api/_lib/whoop-types.ts) ──────
//   The schema keys cycles/recovery/sleep by (user_id, day) and workouts by
//   (user_id, whoop_id). `day` is the member's LOCAL calendar date, computed by
//   shifting the record's UTC instant by its `timezone_offset` (a "-05:00"-style
//   UTC-offset string, per whoop-types.ts) and reading the wall-clock date. Doing
//   this in local time means an activity just after midnight UTC lands on the
//   correct local day.
//
//   * cycles   → localDay(cycle.start,   cycle.timezone_offset)
//                A cycle IS a physiological day; `start` is its anchor.
//   * sleep    → localDay(sleep.start,   sleep.timezone_offset)
//                We SKIP naps (`nap === true`) so a nap can't clobber the main
//                sleep on the (user_id, day) unique key. Naps are counted as
//                `skipped`, not errors. (See TODO(verify) below re: night
//                attribution.)
//   * workouts → localDay(workout.start, workout.timezone_offset)
//                Keyed by (user_id, whoop_id), so multiple workouts/day coexist;
//                `day` is only for range queries.
//   * recovery → HAS NO start/timezone_offset of its own (whoop-types.ts:
//                WhoopRecoveryBase is just cycle_id/sleep_id/user_id/*_at). A
//                recovery scores a cycle, so we take the day from the LINKED
//                cycle (recovery.cycle_id → cycle.start's local day), falling
//                back to the linked sleep (recovery.sleep_id → sleep.start's
//                local day), and only then to recovery.created_at's UTC date.
//
// ── THE `deduped` COUNT (why fetched != upserted) ────────────────────────────
//   cycles/recovery/sleep are keyed UNIQUE(user_id, day), so at most ONE row per
//   local day survives. When WHOOP returns two records that map to the same day
//   (e.g. a fragmented sleep, or a cycle boundary quirk), we collapse them —
//   keeping the one with the newest `updated_at` — and count the drop as
//   `deduped`. So: fetched = upserted + skipped + deduped + errored. This is a
//   property of the Phase-2.3 (user_id, day) schema, not a bug; a per-record key
//   would be a Phase 2.4 schema change.
//
//   TODO(verify) — timezone_offset shape: whoop-types.ts documents "-05:00" from
//     a single 2026-06-30 capture. localDay() also tolerates "-0500"/"Z"; if a
//     real payload ever shows minutes-as-int, revisit parseOffsetMinutes().
//   TODO(verify) — sleep night attribution: WHOOP's UI often attributes an
//     overnight sleep to the WAKE day, whereas we key on `start` (the day you lay
//     down). Confirm which the dashboard wants; switching to `end` is a one-line
//     change if so. Nap-skipping also means "sleep for day X" is the MAIN sleep.
//   TODO(verify) — recovery.created_at fallback uses the UTC date (recovery has
//     no offset). Only hit when a recovery's cycle AND sleep are both outside the
//     synced window; widen the window or link via a stored cycle if it matters.

import { getSupabaseAdmin } from './supabase.js';
import {
  getCycles,
  getRecovery,
  getSleep,
  getWorkouts,
  WhoopApiError,
  WhoopAuthError,
} from './whoop.js';
import type { CollectionQuery } from './whoop.js';
import type {
  WhoopCycle,
  WhoopRecovery,
  WhoopScoreState,
  WhoopSleep,
  WhoopWorkout,
} from './whoop-types.js';

// ── Public shapes ────────────────────────────────────────────────────────────
export type SyncResource = 'cycles' | 'recovery' | 'sleep' | 'workouts';

/** Per-resource result. Safe to log verbatim — counts + a status string only. */
export interface ResourceSyncSummary {
  resource: SyncResource;
  /** Records WHOOP returned for the window. */
  fetched: number;
  /** Rows written (insert-or-update) to Postgres. */
  upserted: number;
  /** Records intentionally not written (naps, or an undatable record). */
  skipped: number;
  /** Records collapsed onto an already-seen (user_id, day) key — see header. */
  deduped: number;
  /** Records/rows that failed to process or write. */
  errored: number;
  /** Resource-level failure (e.g. a non-401 WHOOP or DB error). No secrets. */
  error?: string;
}

/** Whole-user result from syncAll. */
export interface UserSyncSummary {
  /** WHOOP member id that was synced (safe to log — it's not a secret). */
  userId: string;
  /** Inclusive window actually used (ISO date-time). */
  window: { start: string; end: string };
  /**
   * True when WHOOP rejected the token (401) — the caller must surface
   * "re-auth required" and NOT retry. When set, `results` is whatever completed
   * before the 401.
   */
  reauthRequired?: boolean;
  results: ResourceSyncSummary[];
}

/**
 * Re-auth signal. syncAll catches this and reports it via `reauthRequired`
 * rather than throwing, but the individual syncX helpers throw it so a caller
 * driving them directly can distinguish "token dead" (stop, do not retry) from a
 * transient resource error.
 */
export class SyncReauthRequiredError extends Error {
  readonly userId: string;
  constructor(userId: string, cause: WhoopAuthError) {
    super('WHOOP re-authentication required (token rejected with 401).', { cause });
    this.name = 'SyncReauthRequiredError';
    this.userId = userId;
  }
}

/** Date window for a sync run. Both ISO date-time; omit for the default lookback. */
export interface SyncWindow {
  start?: string;
  end?: string;
  /** Lookback in days when `start` is omitted. Default 7 (the cron path). */
  lookbackDays?: number;
}

// ── Window resolution ────────────────────────────────────────────────────────
const DEFAULT_LOOKBACK_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Resolve a {start,end} ISO window; default = [now - lookbackDays, now]. */
export function resolveWindow(window: SyncWindow = {}): { start: string; end: string } {
  const end = window.end ?? new Date().toISOString();
  if (window.start) {
    return { start: window.start, end };
  }
  const lookback = window.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const start = new Date(Date.parse(end) - lookback * DAY_MS).toISOString();
  return { start, end };
}

// ── Local-day derivation ─────────────────────────────────────────────────────
/**
 * Parse a WHOOP UTC-offset string into signed minutes. Handles "-05:00", "-0500",
 * "+01:00", and "Z"/"+00:00". Returns null if it can't be parsed (caller decides
 * the fallback) so we never silently assume UTC for a malformed offset.
 */
function parseOffsetMinutes(offset: string | null | undefined): number | null {
  if (!offset) {
    return null;
  }
  const trimmed = offset.trim();
  if (trimmed === 'Z' || trimmed === 'z') {
    return 0;
  }
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(trimmed);
  if (!m) {
    return null;
  }
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/** Format a Date's UTC components as YYYY-MM-DD (a Postgres `date`). */
function formatUtcDate(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/**
 * The member-local calendar date of an instant. Shift the UTC instant by the
 * record's offset, then read the wall-clock date. If the offset is missing/bad,
 * fall back to the UTC date (documented per-resource above).
 */
function localDay(isoInstant: string, offset: string | null | undefined): string | null {
  const ms = Date.parse(isoInstant);
  if (Number.isNaN(ms)) {
    return null;
  }
  const offsetMinutes = parseOffsetMinutes(offset) ?? 0;
  return formatUtcDate(new Date(ms + offsetMinutes * 60_000));
}

// ── Row shaping + upsert ─────────────────────────────────────────────────────
/**
 * The columns every synced table shares. `id`/`created_at` are left to their DB
 * defaults. The per-resource row types below add the typed columns from
 * 0003_typed_columns.sql (Phase 2.4) — all nullable in the schema, and null
 * whenever score_state !== 'SCORED'.
 */
interface CacheRow {
  user_id: string;
  whoop_id: string;
  day: string;
  raw: unknown;
  updated_at: string;
}

interface CycleRow extends CacheRow {
  score_state: WhoopScoreState;
  start: string;
  end: string | null;
  timezone_offset: string;
  strain: number | null;
  kilojoule: number | null;
  average_heart_rate: number | null;
  max_heart_rate: number | null;
}

interface RecoveryRow extends CacheRow {
  score_state: WhoopScoreState;
  recovery_score: number | null;
  resting_heart_rate: number | null;
  hrv_rmssd_milli: number | null;
  spo2_percentage: number | null;
  skin_temp_celsius: number | null;
  user_calibrating: boolean | null;
}

interface SleepRow extends CacheRow {
  score_state: WhoopScoreState;
  start: string;
  end: string;
  timezone_offset: string;
  nap: boolean;
  sleep_performance_percentage: number | null;
  sleep_efficiency_percentage: number | null;
  sleep_consistency_percentage: number | null;
  respiratory_rate: number | null;
  total_light_sleep_time_milli: number | null;
  total_slow_wave_sleep_time_milli: number | null;
  total_rem_sleep_time_milli: number | null;
  total_awake_time_milli: number | null;
  total_in_bed_time_milli: number | null;
  disturbance_count: number | null;
  need_from_sleep_debt_milli: number | null;
}

interface WorkoutRow extends CacheRow {
  score_state: WhoopScoreState;
  start: string;
  end: string;
  timezone_offset: string;
  sport_name: string;
  sport_id: number;
  strain: number | null;
  average_heart_rate: number | null;
  max_heart_rate: number | null;
  kilojoule: number | null;
  // Nullable even when SCORED — no-GPS activities carry no distance.
  distance_meter: number | null;
}

/** Cycle_id/sleep_id → member-local day, used to date recovery records. */
export type DayIndex = Map<number | string, string>;

const TABLE: Record<SyncResource, string> = {
  cycles: 'whoop_cycles',
  recovery: 'whoop_recovery',
  sleep: 'whoop_sleep',
  workouts: 'whoop_workouts',
};

/** The WHOOP `updated_at` of a record (ms), for choosing a winner on dedupe. */
function rawUpdatedAtMs(row: CacheRow): number {
  const u = (row.raw as { updated_at?: string } | null)?.updated_at;
  const t = u ? Date.parse(u) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Dedupe rows by their conflict key, keeping the NEWEST (max updated_at). A batch
 * upsert must not contain two rows with the same conflict key — Postgres
 * ON CONFLICT DO UPDATE cannot touch the same row twice in one statement.
 */
function dedupeByKey(rows: CacheRow[], keyOf: (r: CacheRow) => string): CacheRow[] {
  const byKey = new Map<string, CacheRow>();
  for (const row of rows) {
    const key = keyOf(row);
    const existing = byKey.get(key);
    if (!existing || rawUpdatedAtMs(row) >= rawUpdatedAtMs(existing)) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()];
}

/** Dedupe then batch-upsert already-shaped rows for a resource; return summary. */
async function upsertResource(
  resource: SyncResource,
  fetched: number,
  rows: CacheRow[],
  skipped: number,
  keyOf: (r: CacheRow) => string,
  onConflict: string,
): Promise<ResourceSyncSummary> {
  const deduped = dedupeByKey(rows, keyOf);
  const dedupedCount = rows.length - deduped.length;
  const base = { resource, fetched, skipped, deduped: dedupedCount };

  if (deduped.length === 0) {
    return { ...base, upserted: 0, errored: 0 };
  }
  const { error } = await getSupabaseAdmin().from(TABLE[resource]).upsert(deduped, { onConflict });
  if (error) {
    return {
      ...base,
      upserted: 0,
      errored: deduped.length,
      error: `DB upsert failed: ${error.message}`,
    };
  }
  return { ...base, upserted: deduped.length, errored: 0 };
}

/**
 * Normalize a fetch failure: a 401 becomes SyncReauthRequiredError (THROWN — the
 * caller must surface re-auth and not retry); any other WhoopApiError becomes a
 * resource-level error summary (RETURNED, so one bad resource doesn't sink the
 * run); anything else rethrows.
 */
function classifyFetchError(
  resource: SyncResource,
  userId: string,
  err: unknown,
): ResourceSyncSummary {
  if (err instanceof WhoopAuthError) {
    throw new SyncReauthRequiredError(userId, err);
  }
  if (err instanceof WhoopApiError) {
    return {
      resource,
      fetched: 0,
      upserted: 0,
      skipped: 0,
      deduped: 0,
      errored: 0,
      error: `WHOOP fetch failed (status ${err.status}) @ ${err.endpoint}`,
    };
  }
  throw err;
}

// ── Row builders (pure: records → rows, plus the day index where relevant) ───
function buildCycleRows(
  userId: string,
  records: WhoopCycle[],
  now: string,
): { rows: CycleRow[]; skipped: number; index: DayIndex } {
  const index: DayIndex = new Map();
  const rows: CycleRow[] = [];
  let skipped = 0;
  for (const c of records) {
    const day = localDay(c.start, c.timezone_offset);
    if (!day) {
      skipped += 1; // undatable — flag by omission, never guess a day
      continue;
    }
    index.set(c.id, day);
    // score is null unless SCORED (discriminated union in whoop-types.ts).
    const score = c.score_state === 'SCORED' ? c.score : null;
    rows.push({
      user_id: userId,
      whoop_id: String(c.id),
      day,
      raw: c,
      updated_at: now,
      score_state: c.score_state,
      start: c.start,
      end: c.end,
      timezone_offset: c.timezone_offset,
      strain: score?.strain ?? null,
      kilojoule: score?.kilojoule ?? null,
      average_heart_rate: score?.average_heart_rate ?? null,
      max_heart_rate: score?.max_heart_rate ?? null,
    });
  }
  return { rows, skipped, index };
}

function buildSleepRows(
  userId: string,
  records: WhoopSleep[],
  now: string,
): { rows: SleepRow[]; skipped: number; index: DayIndex } {
  const index: DayIndex = new Map();
  const rows: SleepRow[] = [];
  let skipped = 0;
  for (const s of records) {
    // Skip naps: the (user_id, day) key holds ONE sleep/day; a nap must not
    // overwrite the main sleep. Counted as skipped, not an error.
    if (s.nap) {
      skipped += 1;
      continue;
    }
    const day = localDay(s.start, s.timezone_offset);
    if (!day) {
      skipped += 1;
      continue;
    }
    index.set(s.id, day);
    const score = s.score_state === 'SCORED' ? s.score : null;
    rows.push({
      user_id: userId,
      whoop_id: s.id,
      day,
      raw: s,
      updated_at: now,
      score_state: s.score_state,
      start: s.start,
      end: s.end,
      timezone_offset: s.timezone_offset,
      nap: s.nap,
      sleep_performance_percentage: score?.sleep_performance_percentage ?? null,
      sleep_efficiency_percentage: score?.sleep_efficiency_percentage ?? null,
      sleep_consistency_percentage: score?.sleep_consistency_percentage ?? null,
      respiratory_rate: score?.respiratory_rate ?? null,
      total_light_sleep_time_milli: score?.stage_summary.total_light_sleep_time_milli ?? null,
      total_slow_wave_sleep_time_milli:
        score?.stage_summary.total_slow_wave_sleep_time_milli ?? null,
      total_rem_sleep_time_milli: score?.stage_summary.total_rem_sleep_time_milli ?? null,
      total_awake_time_milli: score?.stage_summary.total_awake_time_milli ?? null,
      total_in_bed_time_milli: score?.stage_summary.total_in_bed_time_milli ?? null,
      disturbance_count: score?.stage_summary.disturbance_count ?? null,
      need_from_sleep_debt_milli: score?.sleep_needed.need_from_sleep_debt_milli ?? null,
    });
  }
  return { rows, skipped, index };
}

function buildWorkoutRows(
  userId: string,
  records: WhoopWorkout[],
  now: string,
): { rows: WorkoutRow[]; skipped: number } {
  const rows: WorkoutRow[] = [];
  let skipped = 0;
  for (const w of records) {
    const day = localDay(w.start, w.timezone_offset);
    if (!day) {
      skipped += 1;
      continue;
    }
    const score = w.score_state === 'SCORED' ? w.score : null;
    rows.push({
      user_id: userId,
      whoop_id: w.id,
      day,
      raw: w,
      updated_at: now,
      score_state: w.score_state,
      start: w.start,
      end: w.end,
      timezone_offset: w.timezone_offset,
      sport_name: w.sport_name,
      sport_id: w.sport_id,
      strain: score?.strain ?? null,
      average_heart_rate: score?.average_heart_rate ?? null,
      max_heart_rate: score?.max_heart_rate ?? null,
      kilojoule: score?.kilojoule ?? null,
      distance_meter: score?.distance_meter ?? null,
    });
  }
  return { rows, skipped };
}

function buildRecoveryRows(
  userId: string,
  records: WhoopRecovery[],
  cycleDayIndex: DayIndex,
  sleepDayIndex: DayIndex,
  now: string,
): { rows: RecoveryRow[]; skipped: number } {
  const rows: RecoveryRow[] = [];
  let skipped = 0;
  for (const r of records) {
    // Prefer the linked cycle's day; fall back to the linked sleep; last resort
    // is recovery.created_at's UTC date (recovery carries no offset — see header).
    const day =
      cycleDayIndex.get(r.cycle_id) ??
      sleepDayIndex.get(r.sleep_id) ??
      localDay(r.created_at, null);
    if (!day) {
      skipped += 1;
      continue;
    }
    const score = r.score_state === 'SCORED' ? r.score : null;
    // whoop_id: recovery has no id of its own; it is 1:1 with a cycle, so we key
    // the stored row by cycle_id (same value the day was derived from).
    rows.push({
      user_id: userId,
      whoop_id: String(r.cycle_id),
      day,
      raw: r,
      updated_at: now,
      score_state: r.score_state,
      recovery_score: score?.recovery_score ?? null,
      resting_heart_rate: score?.resting_heart_rate ?? null,
      hrv_rmssd_milli: score?.hrv_rmssd_milli ?? null,
      spo2_percentage: score?.spo2_percentage ?? null,
      skin_temp_celsius: score?.skin_temp_celsius ?? null,
      user_calibrating: score?.user_calibrating ?? null,
    });
  }
  return { rows, skipped };
}

// ── Internal run* helpers: fetch → build → upsert, exposing indexes ─────────
async function runCycles(
  userId: string,
  q: CollectionQuery,
): Promise<{ summary: ResourceSyncSummary; index: DayIndex }> {
  let records: WhoopCycle[];
  try {
    records = await getCycles(userId, q);
  } catch (err) {
    return { summary: classifyFetchError('cycles', userId, err), index: new Map() };
  }
  const built = buildCycleRows(userId, records, new Date().toISOString());
  const summary = await upsertResource(
    'cycles',
    records.length,
    built.rows,
    built.skipped,
    (r) => r.day,
    'user_id,day',
  );
  return { summary, index: built.index };
}

async function runSleep(
  userId: string,
  q: CollectionQuery,
): Promise<{ summary: ResourceSyncSummary; index: DayIndex }> {
  let records: WhoopSleep[];
  try {
    records = await getSleep(userId, q);
  } catch (err) {
    return { summary: classifyFetchError('sleep', userId, err), index: new Map() };
  }
  const built = buildSleepRows(userId, records, new Date().toISOString());
  const summary = await upsertResource(
    'sleep',
    records.length,
    built.rows,
    built.skipped,
    (r) => r.day,
    'user_id,day',
  );
  return { summary, index: built.index };
}

async function runWorkouts(userId: string, q: CollectionQuery): Promise<ResourceSyncSummary> {
  let records: WhoopWorkout[];
  try {
    records = await getWorkouts(userId, q);
  } catch (err) {
    return classifyFetchError('workouts', userId, err);
  }
  const built = buildWorkoutRows(userId, records, new Date().toISOString());
  // Keyed by whoop_id (a day can have several workouts).
  return upsertResource(
    'workouts',
    records.length,
    built.rows,
    built.skipped,
    (r) => r.whoop_id,
    'user_id,whoop_id',
  );
}

async function runRecovery(
  userId: string,
  q: CollectionQuery,
  cycleDayIndex: DayIndex,
  sleepDayIndex: DayIndex,
): Promise<ResourceSyncSummary> {
  let records: WhoopRecovery[];
  try {
    records = await getRecovery(userId, q);
  } catch (err) {
    return classifyFetchError('recovery', userId, err);
  }
  const built = buildRecoveryRows(
    userId,
    records,
    cycleDayIndex,
    sleepDayIndex,
    new Date().toISOString(),
  );
  return upsertResource(
    'recovery',
    records.length,
    built.rows,
    built.skipped,
    (r) => r.day,
    'user_id,day',
  );
}

// ── Public per-resource sync functions ───────────────────────────────────────
export async function syncCycles(
  userId: string,
  window: SyncWindow = {},
): Promise<ResourceSyncSummary> {
  return (await runCycles(userId, resolveWindow(window))).summary;
}

export async function syncSleep(
  userId: string,
  window: SyncWindow = {},
): Promise<ResourceSyncSummary> {
  return (await runSleep(userId, resolveWindow(window))).summary;
}

export async function syncWorkouts(
  userId: string,
  window: SyncWindow = {},
): Promise<ResourceSyncSummary> {
  return runWorkouts(userId, resolveWindow(window));
}

/**
 * Sync recovery. Recovery has no date of its own, so we resolve each record's day
 * from the linked cycle (preferred) or sleep. Standalone, this builds those
 * indexes by fetching cycles then sleep SEQUENTIALLY (no concurrent refresh);
 * syncAll passes prebuilt indexes so nothing is fetched twice.
 */
export async function syncRecovery(
  userId: string,
  window: SyncWindow = {},
  indexes?: { cycleDayIndex: DayIndex; sleepDayIndex: DayIndex },
): Promise<ResourceSyncSummary> {
  const q = resolveWindow(window);
  let cycleDayIndex = indexes?.cycleDayIndex;
  let sleepDayIndex = indexes?.sleepDayIndex;

  if (!cycleDayIndex || !sleepDayIndex) {
    const now = new Date().toISOString();
    try {
      // Sequential — never parallel (see the CONCURRENCY note in the header).
      cycleDayIndex ??= buildCycleRows(userId, await getCycles(userId, q), now).index;
      sleepDayIndex ??= buildSleepRows(userId, await getSleep(userId, q), now).index;
    } catch (err) {
      return classifyFetchError('recovery', userId, err);
    }
  }
  return runRecovery(userId, q, cycleDayIndex, sleepDayIndex);
}

// ── Webhook-driven delete (hard delete — see api/webhook.ts) ─────────────────
/** Result of a `*.deleted` webhook. Safe to log verbatim — a count only. */
export interface ResourceDeleteSummary {
  resource: SyncResource;
  /** Rows removed. 0 is normal — the record may never have been cached. */
  deleted: number;
  /** DB-level failure (no secrets). When set, `deleted` is 0. */
  error?: string;
}

/**
 * Remove a single cached record in response to a WHOOP `*.deleted` webhook.
 * WHOOP is the source of truth; when it drops a record we HARD-delete our cached
 * copy (the tables are a pure cache — see supabase/migrations/0001_init.sql).
 *
 * `identifier` is the v2 resource id the webhook carries (see api/webhook.ts).
 * We match on the column that actually holds THAT id, which is not always the
 * (user_id, day) upsert key:
 *   * workouts → whoop_id IS the workout UUID (its own upsert key).       clean
 *   * sleep    → the row is keyed (user_id, day), but the sleep UUID is
 *                preserved in whoop_id, so we match on whoop_id.          clean
 *   * recovery → the webhook id is the associated SLEEP UUID, whereas our
 *                recovery row's whoop_id is the cycle_id. The sleep UUID lives
 *                only in the raw payload, so we match raw->>'sleep_id'.
 * WHOOP emits no cycle deletes, so `cycles` is unreachable via this path.
 */
export async function deleteRecord(
  resource: SyncResource,
  userId: string,
  identifier: string,
): Promise<ResourceDeleteSummary> {
  const base = getSupabaseAdmin().from(TABLE[resource]).delete().eq('user_id', userId);
  // recovery.whoop_id is the cycle_id; the webhook id is the linked sleep UUID.
  const filtered =
    resource === 'recovery'
      ? base.eq('raw->>sleep_id', identifier)
      : base.eq('whoop_id', identifier);
  // return=representation gives us the deleted rows so we can COUNT them; we
  // select only whoop_id so no raw health payload comes back to be logged.
  const { data, error } = await filtered.select('whoop_id');
  if (error) {
    return { resource, deleted: 0, error: `DB delete failed: ${error.message}` };
  }
  return { resource, deleted: data?.length ?? 0 };
}

// ── Orchestrator ─────────────────────────────────────────────────────────────
/**
 * Sync every resource for one member over one window. Fetches each collection
 * exactly once, SEQUENTIALLY, and threads the cycle/sleep day maps into recovery.
 * A 401 anywhere is caught and reported via `reauthRequired` (the caller must
 * surface re-auth and not retry); other per-resource failures are reported
 * in-band so one bad resource doesn't sink the run.
 */
export async function syncAll(userId: string, window: SyncWindow = {}): Promise<UserSyncSummary> {
  const w = resolveWindow(window);
  const results: ResourceSyncSummary[] = [];

  try {
    const cycles = await runCycles(userId, w);
    results.push(cycles.summary);

    const sleep = await runSleep(userId, w);
    results.push(sleep.summary);

    results.push(await runWorkouts(userId, w));
    results.push(await runRecovery(userId, w, cycles.index, sleep.index));
  } catch (err) {
    if (err instanceof SyncReauthRequiredError || err instanceof WhoopAuthError) {
      return { userId, window: w, reauthRequired: true, results };
    }
    throw err;
  }

  return { userId, window: w, results };
}
