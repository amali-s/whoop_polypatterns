// Chart-ready data transforms (Phase 2.6 — the shaping layer for Phase 4's D3 charts).
//
// This module turns arrays of the typed cache rows (whoop_cycles / whoop_recovery /
// whoop_sleep / whoop_workouts — the typed columns added in
// supabase/migrations/0003_typed_columns.sql, Phase 2.4) into the per-day / per-night
// series the charts render. It is the READ counterpart to sync.ts's WRITE path.
//
// PURITY / IMPORT CONTRACT (the whole point of this file):
//   - NO side effects: no network, no DB, no I/O, no logging, no mutation of inputs.
//   - NO imports from sync.ts, whoop.ts, or supabase.ts (nor any other module). Data
//     in, data out — so every function is trivially unit-testable with hand-built
//     fixtures (see scripts/test-transforms.mjs). This file has zero imports on
//     purpose; keep it that way.
//   - Safe to import from EITHER the server (an API endpoint) OR the browser bundle,
//     precisely because it touches no server-only secret-holding module.
//
// NULL DISCIPLINE (inherited from Phase 2.4):
//   Every score-derived typed column is NULL whenever score_state !== 'SCORED'
//   (WHOOP returns score: null in the PENDING_SCORE / UNSCORABLE states — see
//   whoop-types.ts). These transforms preserve that: a missing or unscored value
//   becomes `null` on the output, NEVER 0, NEVER an interpolated guess. The charts
//   need to render a genuine gap, not a fabricated zero. As a belt-and-braces guard
//   we ALSO gate on score_state here, so a stale row carrying a leftover value under
//   a non-SCORED state can't leak a number.
//
// Input interfaces below mirror the typed columns in 0003_typed_columns.sql
// field-for-field (names + nullability), so a future API endpoint (Phase 4 wiring)
// can pass DB rows straight in with no mapping layer. They are intentionally NOT the
// unexported CycleRow/… writer types from sync.ts (those are internal to the upsert
// path); these are the READ-side DTOs.
//
// SLEEP `day` ATTRIBUTION: the `day` on a sleep row is whatever sync.ts attributed it
// (currently the LAY-DOWN local day of `start`; there's an open TODO(verify) in
// sync.ts about start-day vs wake-day). We do NOT re-derive it here — buildSleepStage-
// Breakdown groups by the `day` it is handed. If that attribution ever changes in
// sync.ts, these night dates shift with it automatically; nothing here needs editing.

// ── Score state (mirrors WhoopScoreState in whoop-types.ts; redeclared to keep this
//    file import-free) ──────────────────────────────────────────────────────────────
export type ScoreState = 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';

// ── Input row DTOs (one per synced table; fields = 0003_typed_columns.sql) ─────────
/** A whoop_cycles row (typed columns from 0003, plus its `day` key). */
export interface CycleMetricRow {
  day: string;
  score_state: ScoreState | null;
  strain: number | null;
  kilojoule: number | null;
  average_heart_rate: number | null;
  max_heart_rate: number | null;
  start: string | null;
  end: string | null;
  timezone_offset: string | null;
}

/** A whoop_recovery row. */
export interface RecoveryMetricRow {
  day: string;
  score_state: ScoreState | null;
  recovery_score: number | null;
  resting_heart_rate: number | null;
  hrv_rmssd_milli: number | null;
  spo2_percentage: number | null;
  skin_temp_celsius: number | null;
  user_calibrating: boolean | null;
}

/** A whoop_sleep row. */
export interface SleepMetricRow {
  day: string;
  score_state: ScoreState | null;
  start: string | null;
  end: string | null;
  timezone_offset: string | null;
  nap: boolean | null;
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

/** A whoop_workouts row (keyed per-workout in the DB, so a day can have several). */
export interface WorkoutMetricRow {
  day: string;
  score_state: ScoreState | null;
  start: string | null;
  end: string | null;
  timezone_offset: string | null;
  sport_name: string | null;
  sport_id: number | null;
  strain: number | null;
  average_heart_rate: number | null;
  max_heart_rate: number | null;
  kilojoule: number | null;
  distance_meter: number | null;
}

// ── Output shapes ──────────────────────────────────────────────────────────────────
/** Inclusive calendar-day window [start, end], both YYYY-MM-DD. */
export interface DateRange {
  start: string;
  end: string;
}

/**
 * One point per calendar day. Every metric is `null` when that day has no row, or the
 * row is not SCORED — never 0. `totalSleepMilli` is DERIVED from the stage columns
 * (light + deep + rem), not read from a fabricated "total" field. `workoutStrainSum`
 * / `workoutCount` are null on a day with no workout rows at all (keeps a data-less
 * day fully null so a chart renders a gap rather than a fake zero); a day WITH
 * workouts gets the real count and the sum of its SCORED strains.
 */
export interface DailyMetricPoint {
  day: string;
  strain: number | null;
  recoveryScore: number | null;
  hrvRmssdMilli: number | null;
  restingHeartRate: number | null;
  /**
   * WHOOP 4.0+ hardware only (0003_typed_columns.sql) — older straps never
   * report it, so long all-null runs are EXPECTED here, not a data bug.
   */
  skinTempCelsius: number | null;
  sleepPerformancePercentage: number | null;
  totalSleepMilli: number | null;
  workoutStrainSum: number | null;
  workoutCount: number | null;
}

/** One point per night for the stacked-stage bar (chart 4.1). Minutes, not millis. */
export interface SleepStageBreakdownPoint {
  day: string;
  awakeMinutes: number | null;
  lightMinutes: number | null;
  deepMinutes: number | null;
  remMinutes: number | null;
  /** Sum of the four stage minutes above (so a stacked bar's segments add up exactly). */
  totalMinutes: number | null;
}

/** One point per input day for a trailing rolling baseline (charts 4.3 line-over-band). */
export interface RollingBaselinePoint {
  day: string;
  /** Trailing-window mean, or null when fewer than `minSamples` non-null values were in window. */
  mean: number | null;
  /** Count of NON-NULL accessor values found inside the trailing window. */
  sampleCount: number;
}

/** Pulls the metric to baseline out of a DailyMetricPoint (e.g. `p => p.hrvRmssdMilli`). */
export type MetricAccessor = (point: DailyMetricPoint) => number | null;

/** Options for buildRollingBaseline. */
export interface RollingBaselineOptions {
  /** Non-null samples required in the window before a mean is emitted. Default 3. */
  minSamples?: number;
}

// ── Internal constants / helpers (module-private; not exported) ─────────────────────
const DAY_MS = 86_400_000;
const MILLI_PER_MINUTE = 60_000;
/** Default trailing-window sample floor — a parameter, not a magic number at the call site. */
const DEFAULT_MIN_SAMPLES = 3;

/** Parse a YYYY-MM-DD day to its UTC-midnight epoch ms (DST-proof day arithmetic). */
function parseDayUtc(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

/** Format a UTC-midnight epoch ms back to YYYY-MM-DD. */
function formatDayUtc(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/** Every calendar day in [start, end] inclusive, ascending. Empty if the range is invalid. */
function eachDayInclusive(start: string, end: string): string[] {
  const startMs = parseDayUtc(start);
  const endMs = parseDayUtc(end);
  const days: string[] = [];
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return days;
  }
  for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
    days.push(formatDayUtc(ms));
  }
  return days;
}

/**
 * A score-derived value, gated on state. Returns the value only when SCORED;
 * otherwise null — so a non-SCORED row can never contribute a number, even if a
 * stale value lingers in its typed column. `undefined` is normalized to null too.
 */
function scored<T>(state: ScoreState | null, value: T | null | undefined): T | null {
  return state === 'SCORED' ? (value ?? null) : null;
}

/**
 * ROUNDING CHOICE: millis → minutes via divide-by-60000 then Math.round (round
 * half-up to the nearest whole minute). Whole minutes are what the stacked-bar axis
 * wants; sub-minute precision would be noise. `totalMinutes` sums the already-rounded
 * stage minutes (below), so the visible segments always add up to the labeled total —
 * we deliberately do NOT round the raw total separately, which could be off by a
 * minute from the sum of the parts.
 */
function millisToMinutes(milli: number | null): number | null {
  return milli == null ? null : Math.round(milli / MILLI_PER_MINUTE);
}

/** Index rows by `day`, last-wins. (cycles/recovery/sleep are one-per-day upstream.) */
function indexByDay<T extends { day: string }>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    map.set(row.day, row);
  }
  return map;
}

/** Group rows by `day` (workouts — several per day). */
function groupByDay<T extends { day: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.day);
    if (list) {
      list.push(row);
    } else {
      map.set(row.day, [row]);
    }
  }
  return map;
}

/** Actual asleep time (light + deep + rem), null unless SCORED and all three present. */
function totalSleepMilliOf(sleep: SleepMetricRow | undefined): number | null {
  if (!sleep || sleep.score_state !== 'SCORED') {
    return null;
  }
  const light = sleep.total_light_sleep_time_milli;
  const deep = sleep.total_slow_wave_sleep_time_milli;
  const rem = sleep.total_rem_sleep_time_milli;
  if (light == null || deep == null || rem == null) {
    return null;
  }
  return light + deep + rem;
}

/**
 * Aggregate a day's workouts. count = every workout row on the day (scored or not —
 * "don't drop any"); strainSum = the sum of the SCORED workouts' strains, or null if
 * none are scored. A day with no workout rows is all-null (see DailyMetricPoint).
 */
function aggregateWorkouts(rows: WorkoutMetricRow[]): {
  workoutStrainSum: number | null;
  workoutCount: number | null;
} {
  if (rows.length === 0) {
    return { workoutStrainSum: null, workoutCount: null };
  }
  let sum: number | null = null;
  for (const w of rows) {
    const s = scored(w.score_state, w.strain);
    if (s != null) {
      sum = (sum ?? 0) + s;
    }
  }
  return { workoutStrainSum: sum, workoutCount: rows.length };
}

// ── 1. Daily series ─────────────────────────────────────────────────────────────────
/**
 * One DailyMetricPoint per calendar day across [range.start, range.end] INCLUSIVE —
 * even days with no data (they appear with every field null so a chart can render a
 * gap rather than skip the day). Multiple workouts on a day are aggregated into
 * workoutStrainSum / workoutCount; naps are excluded from the sleep-derived fields.
 */
export function buildDailySeries(
  cycles: CycleMetricRow[],
  recovery: RecoveryMetricRow[],
  sleep: SleepMetricRow[],
  workouts: WorkoutMetricRow[],
  range: DateRange,
): DailyMetricPoint[] {
  const cycleByDay = indexByDay(cycles);
  const recoveryByDay = indexByDay(recovery);
  // Exclude naps before indexing so a nap can't clobber the night's main sleep.
  const sleepByDay = indexByDay(sleep.filter((s) => s.nap !== true));
  const workoutsByDay = groupByDay(workouts);

  return eachDayInclusive(range.start, range.end).map((day) => {
    const cycle = cycleByDay.get(day);
    const rec = recoveryByDay.get(day);
    const slp = sleepByDay.get(day);
    const dayWorkouts = workoutsByDay.get(day) ?? [];

    return {
      day,
      strain: cycle ? scored(cycle.score_state, cycle.strain) : null,
      recoveryScore: rec ? scored(rec.score_state, rec.recovery_score) : null,
      hrvRmssdMilli: rec ? scored(rec.score_state, rec.hrv_rmssd_milli) : null,
      restingHeartRate: rec ? scored(rec.score_state, rec.resting_heart_rate) : null,
      skinTempCelsius: rec ? scored(rec.score_state, rec.skin_temp_celsius) : null,
      sleepPerformancePercentage: slp
        ? scored(slp.score_state, slp.sleep_performance_percentage)
        : null,
      totalSleepMilli: totalSleepMilliOf(slp),
      ...aggregateWorkouts(dayWorkouts),
    };
  });
}

// ── 2. Sleep stage breakdown ────────────────────────────────────────────────────────
/**
 * One point per NIGHT for the stacked-stage bar (chart 4.1). Nap rows are skipped
 * (guarded here even though sync.ts already excludes naps from whoop_sleep — the
 * input is not guaranteed pre-filtered, and a nap must not appear as its own bar).
 * Stage millis are converted to whole minutes (see millisToMinutes). An unscored
 * night yields null minutes (a gap), never 0.
 */
export function buildSleepStageBreakdown(sleepRows: SleepMetricRow[]): SleepStageBreakdownPoint[] {
  const points: SleepStageBreakdownPoint[] = [];
  for (const row of sleepRows) {
    if (row.nap === true) {
      continue;
    }
    const isScored = row.score_state === 'SCORED';
    const awakeMinutes = isScored ? millisToMinutes(row.total_awake_time_milli) : null;
    const lightMinutes = isScored ? millisToMinutes(row.total_light_sleep_time_milli) : null;
    const deepMinutes = isScored ? millisToMinutes(row.total_slow_wave_sleep_time_milli) : null;
    const remMinutes = isScored ? millisToMinutes(row.total_rem_sleep_time_milli) : null;
    const totalMinutes =
      awakeMinutes != null && lightMinutes != null && deepMinutes != null && remMinutes != null
        ? awakeMinutes + lightMinutes + deepMinutes + remMinutes
        : null;
    points.push({
      day: row.day,
      awakeMinutes,
      lightMinutes,
      deepMinutes,
      remMinutes,
      totalMinutes,
    });
  }
  return points;
}

// ── 3. Rolling baseline ─────────────────────────────────────────────────────────────
/**
 * Generic trailing rolling baseline. For each point, look back over a window of
 * `windowDays` calendar days ending on (and including) that day, collect the non-null
 * `accessor` values in it, and emit their mean — but ONLY once at least `minSamples`
 * of them exist; below that the mean is null (never a guess from a thin window).
 *
 * Generic on purpose: pass `p => p.hrvRmssdMilli` for chart 4.3's "HRV over rolling
 * baseline", or `p => p.restingHeartRate` for the "RHR over sleep-debt area" variant.
 *
 * `series` is expected in ASCENDING day order (buildDailySeries guarantees this); the
 * backward window scan breaks once it passes the window's lower bound. Gaps are fine —
 * a missing day simply contributes no sample.
 */
export function buildRollingBaseline(
  series: DailyMetricPoint[],
  accessor: MetricAccessor,
  windowDays: number,
  options: RollingBaselineOptions = {},
): RollingBaselinePoint[] {
  const minSamples = options.minSamples ?? DEFAULT_MIN_SAMPLES;
  const dayNums = series.map((p) => parseDayUtc(p.day));

  return series.map((point, i) => {
    const upper = dayNums[i];
    const lower = upper - (windowDays - 1) * DAY_MS;
    const values: number[] = [];
    for (let j = i; j >= 0; j--) {
      if (dayNums[j] < lower) {
        break; // relies on ascending order — everything earlier is also out of window
      }
      const v = accessor(series[j]);
      if (v != null) {
        values.push(v);
      }
    }
    const sampleCount = values.length;
    const mean = sampleCount >= minSamples ? values.reduce((a, b) => a + b, 0) / sampleCount : null;
    return { day: point.day, mean, sampleCount };
  });
}
