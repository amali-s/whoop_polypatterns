// GET /api/sleep-stages?days=<n>
//
// Read endpoint for chart 4.1 (stacked sleep stages). Returns the per-night
// stage breakdown for the session's member over the last `days` calendar days
// (default 30, capped at 90), shaped by buildSleepStageBreakdown (Phase 2.6) —
// the first real caller of the transform layer against DB rows.
//
// SECURITY (mirrors /api/session's posture):
//   - The caller is identified ONLY by the HttpOnly whoop_session cookie; no
//     token material is read or returned (this endpoint never talks to WHOOP —
//     it reads the Supabase cache the daily sync fills).
//   - On failure the body is generic: no Supabase error messages, status
//     codes, or dependency names leave the server. Details go to console.error.
//
// Responses (always JSON):
//   200 { points: SleepStageBreakdownPoint[] }  — points ascending by day;
//       unscored nights carry null minutes (a gap), never 0 (null discipline)
//   401 { error: 'Not authenticated.' }         — no/invalid session cookie
//   503 { waking: true } (+ Retry-After)        — database unavailable, likely
//       the paused/waking free-tier Supabase project (Phase 2.5)
//   500 { error: 'Failed to load sleep stages.' } — unexpected error

import type { IncomingMessage, ServerResponse } from 'node:http';
import { SESSION_COOKIE, decodeSession } from './_lib/tokens.js';
import {
  DatabaseUnavailableError,
  getSupabaseAdmin,
  isDbUnavailableStatus,
} from './_lib/supabase.js';
import { buildSleepStageBreakdown, type SleepMetricRow } from './_lib/transforms.js';

const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
const DAY_MS = 86_400_000;

// Exactly the SleepMetricRow fields (transforms.ts), which mirror the typed
// columns from 0003_typed_columns.sql — so query rows pass straight into
// buildSleepStageBreakdown with no mapping layer.
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

  try {
    const supabase = getSupabaseAdmin();
    const { data, error, status } = await supabase
      .from('whoop_sleep')
      .select(SLEEP_METRIC_COLUMNS)
      .eq('user_id', userId)
      .gte('day', windowStartDay(days))
      .order('day', { ascending: true });

    if (error) {
      // A paused/unreachable Supabase project fails at the gateway level
      // (Phase 2.5) — classify it so the SPA can retry instead of erroring.
      if (isDbUnavailableStatus(status)) {
        throw new DatabaseUnavailableError(status);
      }
      throw new Error(`Failed to read whoop_sleep: ${error.message}`);
    }

    // The selected columns are exactly SleepMetricRow (see SLEEP_METRIC_COLUMNS)
    // — the untyped client can't prove that, hence the cast.
    const rows = (data ?? []) as unknown as SleepMetricRow[];
    json(res, 200, { points: buildSleepStageBreakdown(rows) });
  } catch (err) {
    if (err instanceof DatabaseUnavailableError) {
      console.error(`Sleep stages: database unavailable (status ${err.status}).`);
      res.setHeader('Retry-After', '5');
      json(res, 503, { waking: true });
      return;
    }
    // Log the detail server-side; the client gets a generic body only.
    console.error('Sleep stages read failed:', err);
    json(res, 500, { error: 'Failed to load sleep stages.' });
  }
}
