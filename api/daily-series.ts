// GET /api/daily-series?days=<n>
//
// Read endpoint for chart 4.2 (recovery % over day strain combo). Returns one
// DailyMetricPoint per calendar day for the session's member over the last
// `days` days (default 30, capped at 90), shaped by buildDailySeries (Phase
// 2.6) from all four synced tables. Unlike /api/sleep-stages, EVERY day in
// the window gets a point — dataless days come back all-null so the chart
// renders a gap at real axis width (null discipline), never a skipped day.
//
// SECURITY (mirrors /api/sleep-stages' posture):
//   - The caller is identified ONLY by the HttpOnly whoop_session cookie; no
//     token material is read or returned (this endpoint never talks to WHOOP —
//     it reads the Supabase cache the daily sync fills).
//   - On failure the body is generic: no Supabase error messages, status
//     codes, or dependency names leave the server. Details go to console.error.
//
// Responses (always JSON):
//   200 { points: DailyMetricPoint[] }           — points ascending by day;
//       unscored/missing days carry null metrics (a gap), never 0
//   401 { error: 'Not authenticated.' }          — no/invalid session cookie
//   503 { waking: true } (+ Retry-After)         — database unavailable, likely
//       the paused/waking free-tier Supabase project (Phase 2.5)
//   500 { error: 'Failed to load daily series.' } — unexpected error

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SESSION_COOKIE, decodeSession } from './_lib/tokens.js';
import {
  DatabaseUnavailableError,
  getSupabaseAdmin,
  isDbUnavailableStatus,
} from './_lib/supabase.js';
import {
  buildDailySeries,
  type CycleMetricRow,
  type RecoveryMetricRow,
  type SleepMetricRow,
  type WorkoutMetricRow,
} from './_lib/transforms.js';

const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
const DAY_MS = 86_400_000;

// Exactly the *MetricRow fields (transforms.ts), which mirror the typed
// columns from 0003_typed_columns.sql — so query rows pass straight into
// buildDailySeries with no mapping layer.
const CYCLE_METRIC_COLUMNS = [
  'day',
  'score_state',
  'strain',
  'kilojoule',
  'average_heart_rate',
  'max_heart_rate',
  'start',
  'end',
  'timezone_offset',
].join(', ');

const RECOVERY_METRIC_COLUMNS = [
  'day',
  'score_state',
  'recovery_score',
  'resting_heart_rate',
  'hrv_rmssd_milli',
  'spo2_percentage',
  'skin_temp_celsius',
  'user_calibrating',
].join(', ');

const SLEEP_METRIC_COLUMNS = [
  'day',
  'score_state',
  'start',
  'end',
  'timezone_offset',
  'nap',
  'sleep_performance_percentage',
  'sleep_efficiency_percentage',
  'sleep_consistency_percentage',
  'respiratory_rate',
  'total_light_sleep_time_milli',
  'total_slow_wave_sleep_time_milli',
  'total_rem_sleep_time_milli',
  'total_awake_time_milli',
  'total_in_bed_time_milli',
  'disturbance_count',
  'need_from_sleep_debt_milli',
].join(', ');

const WORKOUT_METRIC_COLUMNS = [
  'day',
  'score_state',
  'start',
  'end',
  'timezone_offset',
  'sport_name',
  'sport_id',
  'strain',
  'average_heart_rate',
  'max_heart_rate',
  'kilojoule',
  'distance_meter',
].join(', ');

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

/** ?days= from the request, defaulted and clamped to [1, MAX_DAYS]. */
function daysFromRequest(req: IncomingMessage): number {
  const url = new URL(req.url ?? '', 'http://localhost');
  const raw = url.searchParams.get('days');
  const parsed = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_DAYS;
  }
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_DAYS);
}

/** First day (YYYY-MM-DD, UTC) of an n-day window ending today. */
function windowStartDay(days: number): string {
  return new Date(Date.now() - (days - 1) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Read one table's metric rows for the member/window. The four tables share
 * an identical query shape (user_id + day window, ascending), so the
 * error-classification path lives once here instead of four times inline.
 * T is the caller's *MetricRow — the untyped client can't prove the selected
 * columns match it, hence the cast (same caveat as /api/sleep-stages).
 */
async function readMetricRows<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  userId: string,
  startDay: string,
): Promise<T[]> {
  const { data, error, status } = await supabase
    .from(table)
    .select(columns)
    .eq('user_id', userId)
    .gte('day', startDay)
    .order('day', { ascending: true });

  if (error) {
    // A paused/unreachable Supabase project fails at the gateway level
    // (Phase 2.5) — classify it so the SPA can retry instead of erroring.
    if (isDbUnavailableStatus(status)) {
      throw new DatabaseUnavailableError(status);
    }
    throw new Error(`Failed to read ${table}: ${error.message}`);
  }
  return (data ?? []) as unknown as T[];
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Decode the opaque session cookie → member id, same as /api/session. A
  // missing/tampered cookie means the browser is not linked — here that is a
  // 401 (the endpoint serves that member's data, so "who" is required).
  const cookies = parseCookies(req.headers.cookie);
  const userId = decodeSession(cookies[SESSION_COOKIE]);
  if (!userId) {
    json(res, 401, { error: 'Not authenticated.' });
    return;
  }

  const days = daysFromRequest(req);
  // Inclusive [start, end] window: start is (days - 1) before end, so the
  // window is exactly `days` wide — buildDailySeries emits one point per day
  // in it, all-null on days no table has a row for.
  const start = windowStartDay(days);
  const end = new Date().toISOString().slice(0, 10);

  try {
    const supabase = getSupabaseAdmin();
    const [cycles, recovery, sleep, workouts] = await Promise.all([
      readMetricRows<CycleMetricRow>(supabase, 'whoop_cycles', CYCLE_METRIC_COLUMNS, userId, start),
      readMetricRows<RecoveryMetricRow>(
        supabase,
        'whoop_recovery',
        RECOVERY_METRIC_COLUMNS,
        userId,
        start,
      ),
      readMetricRows<SleepMetricRow>(supabase, 'whoop_sleep', SLEEP_METRIC_COLUMNS, userId, start),
      readMetricRows<WorkoutMetricRow>(
        supabase,
        'whoop_workouts',
        WORKOUT_METRIC_COLUMNS,
        userId,
        start,
      ),
    ]);

    json(res, 200, { points: buildDailySeries(cycles, recovery, sleep, workouts, { start, end }) });
  } catch (err) {
    if (err instanceof DatabaseUnavailableError) {
      console.error(`Daily series: database unavailable (status ${err.status}).`);
      res.setHeader('Retry-After', '5');
      json(res, 503, { waking: true });
      return;
    }
    // Log the detail server-side; the client gets a generic body only.
    console.error('Daily series read failed:', err);
    json(res, 500, { error: 'Failed to load daily series.' });
  }
}
