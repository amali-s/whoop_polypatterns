// Phase 4.12 — trailing-average delta for the Calories & Sleep stat cards.
//
// Pure date/number logic: ZERO imports, zero I/O — unit-tested by
// scripts/test-stats.mjs the same way src/lib/cycle.ts is by test-cycle.mjs and
// api/_lib/transforms.ts is by test-transforms.mjs. This file mirrors cycle.ts's
// no-imports contract on purpose so Node 24's type-stripping loads it without a
// bundler; keep it import-free. `baselineDelta` is GENERIC over any `{ day }`
// point (constrained below), not tied to DailyMetricPoint, precisely so the
// test can drive it with hand-built fixtures and no /api dependency.
//
// MODEL ("today vs. my normal" — Task 4.12 decisions 2 & 3):
//   - "today" = the LAST point of the ascending series (the current calendar
//     day; the /api/daily-series window ends on today). Its accessor value is
//     the headline number. If it is null → `no-value` (the honest state when
//     today's cycle/sleep isn't SCORED yet — never fall back to yesterday and
//     mislabel it "today").
//   - The baseline is the non-null PRIOR days inside a trailing window of
//     `windowDays` calendar days ending on today, with today itself EXCLUDED
//     (excludeToday) — a day must not inflate the average it is measured
//     against. This diverges from buildRollingBaseline, whose trailing window
//     INCLUDES the current day (that helper feeds a smoothed line where the
//     current point belongs on its own baseline; a headline "vs. my normal"
//     comparison must not).
//   - Off-by-one, stated honestly: the app passes a [today−29, today] window
//     (30 points). Excluding today leaves ≤29 baseline days, NOT 30 — so the
//     caller's visible caption says "your recent average", never "exactly 30".
//   - `minSamples` gates the delta: below it → `no-baseline` (render the value,
//     no delta) rather than a delta computed off a thin window. The caller
//     picks a floor stricter than buildRollingBaseline's default 3 (that 3 was
//     tuned for a forgiving smoothed line, not a headline number).

/**
 * A point the delta can be computed over. Only `day` (an ISO 'YYYY-MM-DD'
 * calendar day) is required by this module; the numeric metric is pulled by the
 * caller's accessor, so this stays decoupled from DailyMetricPoint.
 */
export interface DatedPoint {
  day: string;
}

/** Options for {@link baselineDelta}. All explicit — no magic defaults. */
export interface BaselineDeltaOptions {
  /**
   * Inclusive trailing window size in calendar days, ending on "today" (the
   * last series point). Mirrors buildRollingBaseline's `windowDays`.
   */
  windowDays: number;
  /**
   * Non-null PRIOR days required before a delta is emitted. Below this the
   * result is `no-baseline` — never a delta from a thin window.
   */
  minSamples: number;
  /**
   * Exclude "today" (the last point) from the baseline mean. Decision 3 wants
   * this true ("today vs. my normal"); it is an explicit option so the test can
   * prove today's own value is genuinely absent from the mean.
   */
  excludeToday: boolean;
}

/**
 * The comparison the stat card renders. A discriminated union so callers CANNOT
 * accidentally read a `delta` that doesn't exist (the estimateCycleLength
 * discipline — no substituted default when the answer is genuinely absent).
 */
export type BaselineDelta =
  /** Today's metric is null — nothing to headline (render a muted "—"). */
  | { kind: 'no-value' }
  /** Today has a value but fewer than `minSamples` prior non-null days exist. */
  | { kind: 'no-baseline'; value: number; sampleCount: number }
  /** Full comparison. `delta` = value − mean (native unit); `percentDelta` is
   *  null only when the mean is 0 (no percentage of zero). */
  | {
      kind: 'full';
      value: number;
      mean: number;
      delta: number;
      percentDelta: number | null;
      sampleCount: number;
    };

/**
 * 'YYYY-MM-DD' → integer day number (days since the Unix epoch), UTC-normalized.
 * Copied from src/lib/cycle.ts (kept local to preserve the no-imports contract):
 * local-midnight parsing makes a DST-spanning day 23/25h long, so
 * `(a − b) / 86400000` truncates off by one; UTC has no DST, so every day is
 * exactly 86_400_000 ms and the arithmetic is exact.
 */
function dayNumber(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

/**
 * Compare the last point's `accessor` value against the mean of the prior
 * non-null days in the trailing window. See the module header for the model.
 *
 * `series` is expected in ASCENDING day order (buildDailySeries guarantees it);
 * the backward scan stops once it passes the window's lower bound. Gaps are
 * fine — a null day simply contributes no sample.
 */
export function baselineDelta<T extends DatedPoint>(
  series: readonly T[],
  accessor: (point: T) => number | null,
  options: BaselineDeltaOptions,
): BaselineDelta {
  const { windowDays, minSamples, excludeToday } = options;

  if (series.length === 0) {
    return { kind: 'no-value' };
  }

  const todayIndex = series.length - 1;
  const value = accessor(series[todayIndex]);
  if (value == null) {
    return { kind: 'no-value' };
  }

  // Inclusive window [today − (windowDays − 1), today]. excludeToday drops the
  // last day, leaving ≤ windowDays − 1 candidate PRIOR days (the honest "29 of
  // 30", decision 3). Days older than `lower` are outside the window.
  const todayNum = dayNumber(series[todayIndex].day);
  const lower = todayNum - (windowDays - 1);

  const values: number[] = [];
  for (let i = todayIndex; i >= 0; i--) {
    if (excludeToday && i === todayIndex) {
      continue; // today never counts toward the average it is measured against
    }
    if (dayNumber(series[i].day) < lower) {
      break; // ascending order — everything earlier is out of window too
    }
    const v = accessor(series[i]);
    if (v != null) {
      values.push(v);
    }
  }

  const sampleCount = values.length;
  if (sampleCount < minSamples) {
    return { kind: 'no-baseline', value, sampleCount };
  }

  const mean = values.reduce((a, b) => a + b, 0) / sampleCount;
  const delta = value - mean;
  const percentDelta = mean === 0 ? null : (delta / mean) * 100;
  return { kind: 'full', value, mean, delta, percentDelta, sampleCount };
}
