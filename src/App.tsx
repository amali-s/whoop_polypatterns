import { useEffect, useState } from 'react';
import './App.css';
import { checkSessionWithRetry, type SessionStatus } from './session-check';
import { Card } from './components/Card';
import { Button } from './components/Button';
import { RangeToggle, type RangeToggleOption } from './components/RangeToggle';
import { ChartContainer, type ChartStatus } from './components/ChartContainer';
import { JournalForm } from './components/JournalForm';
import { JournalReminder } from './components/JournalReminder';
import { JournalSummary } from './components/JournalSummary';
import { Tearsheet } from './components/Tearsheet';
import { LoadingState, ErrorState } from './components/states';
import {
  DotMatrix,
  HrvBaselineComboChart,
  HydrationRecoveryDotMatrix,
  ProgressRing,
  RecoveryStrainComboChart,
  RhrBaselineComboChart,
  Sparkline,
  StackedBarChart,
  StatDelta,
  TrendIndicator,
  type StackedBarSeriesKey,
} from './components/charts';
import { cycleState, type PeriodLog } from './lib/cycle';
import { HYDRATION_COLORS, HYDRATION_LABELS, HYDRATION_STATES } from './lib/hydration';
import { recoveryZone } from './lib/recovery';
import { baselineDelta, type BaselineDelta } from './lib/stats';
import { useSleepStages } from './hooks/useSleepStages';
import { useJournalReminder } from './hooks/useJournalReminder';
import type { JournalDayStatus } from './lib/reminder';
import { useDailySeries, type DailySeriesState } from './hooks/useDailySeries';
import type { DailyMetricPoint, SleepStageBreakdownPoint } from '../api/_lib/transforms';
import type { JournalAnswers } from '../api/_lib/journal-types';
import { utcFormat } from 'd3-time-format';

// A WHOOP provider error forwarded by /api/callback via query params.
interface OAuthError {
  error: string;
  description?: string;
  hint?: string;
}

// 'waking' (Phase 2.5): /api/session said the database is unavailable —
// likely the free-tier Supabase project paused/waking — and the retry loop in
// session-check.ts is still running. Distinct from 'loading' so the user sees
// WHY the check is taking longer than a beat.
type ConnectionState = 'loading' | 'waking' | 'connected' | 'disconnected';

const STATUS_LABELS: Record<ConnectionState, string> = {
  loading: 'Checking connection…',
  waking: 'Waking database…',
  connected: 'Connected',
  disconnected: 'Not connected',
};

/** Outcome of a manual "Sync now" press (POST /api/sync-me). */
type ManualSyncState =
  | 'idle'
  | 'syncing'
  /** 429 — pressed again inside the endpoint's cooldown. */
  | 'cooldown'
  /** WHOOP rejected the stored token; the member must reconnect. */
  | 'reauth'
  | 'error';

/** Button label for each manual-sync state. */
const SYNC_LABELS: Record<ManualSyncState, string> = {
  idle: 'Sync now',
  syncing: 'Syncing…',
  cooldown: 'Just synced',
  reauth: 'Reconnect needed',
  error: 'Sync failed — retry',
};

// Bento tile set — matches the confirmed Figma layout (file
// BWF8m6iu8eQJqJghVUbsOQ, node 86:71) tile for tile: period meter, journal,
// 4 stat/donut tiles, skin-temp sparkline, and the two HRV/RHR combo charts.
// Task 3.3: each tile now renders on Card + ChartContainer; the tile content
// is still static placeholder markup passed as ready-state children — real
// data + real chart rendering is Phase 4, which swaps the children for a D3
// chart and drives ChartContainer's status from fetch state. Daily journal
// has no data source yet (questionnaire is Phase 5) and is explicitly a stub.

// Chart 4.1 — sleep-stage segment order (bottom-to-top: deepest at the bottom,
// awake on top) and hue assignment.
//
// CONFIRMED 2026-08-01, and no longer borrowed from the shared chart palette.
// The four stages used to reuse --color-chart-5 / -2 / -1 / -4, which design.md
// §4 flagged as a compromise ("four distinct stage hues require reusing three
// reserved tokens"). Two of those tokens have since been repointed to other
// metrics — chart-5 is now Strain's azure, chart-4 the HRV/RHR baseline — so
// the borrow ended. These are the chart's OWN dedicated tokens (§1), a dark→
// light green ramp so bar depth reads as sleep depth.
const SLEEP_STAGE_KEYS: StackedBarSeriesKey<SleepStageBreakdownPoint>[] = [
  { key: 'deepMinutes', label: 'Deep', color: 'var(--color-sleep-deep)' },
  { key: 'remMinutes', label: 'REM', color: 'var(--color-sleep-rem)' },
  { key: 'lightMinutes', label: 'Light', color: 'var(--color-sleep-light)' },
  { key: 'awakeMinutes', label: 'Awake', color: 'var(--color-sleep-awake)' },
];

const SLEEP_STAGE_DAYS = 30;

/**
 * Full-width stacked-bar row below the bento grid (design.md §2 "Layout gap"
 * decision: Phase 4 charts without a bento slot get their own rows at the
 * dashboard's 1200px column width). Drives ChartContainer's status from the
 * fetch state (4.8 wiring for this tile).
 */
function SleepStagesTile() {
  const stages = useSleepStages(SLEEP_STAGE_DAYS);
  const points = stages.status === 'ready' ? stages.points : [];
  const status: ChartStatus =
    stages.status === 'unauthenticated' || (stages.status === 'ready' && points.length === 0)
      ? 'empty'
      : stages.status;
  return (
    <ChartContainer
      title="Sleep stages per night"
      subtitle={`Awake, light, deep and REM minutes — last ${SLEEP_STAGE_DAYS} nights`}
      status={status}
      loadingLabel="Loading your sleep stages…"
      emptyMessage={
        stages.status === 'unauthenticated'
          ? 'Connect your WHOOP account to see your sleep stages.'
          : `No sleep data in the last ${SLEEP_STAGE_DAYS} nights — run a sync, then refresh.`
      }
      errorMessage="Couldn’t load sleep stages. Refresh to try again."
    >
      <StackedBarChart
        data={points}
        keys={SLEEP_STAGE_KEYS}
        day={(p) => p.day}
        total={(p) => p.totalMinutes}
        title="Sleep stages per night"
        tableCaption={`Sleep stage minutes per night, last ${SLEEP_STAGE_DAYS} nights`}
        unit="minutes"
      />
    </ChartContainer>
  );
}

/**
 * The two windows the bento time-range toggle (4.14) offers. Replaces the
 * fixed `RECOVERY_STRAIN_DAYS = 30` this file used through 4.13: every
 * range-driven tile now reads App's live `rangeDays` state instead, so the
 * window and the copy that names it can never drift apart.
 *
 * 90 is the ceiling because `/api/daily-series` already clamps `?days=` to
 * MAX_DAYS = 90 — no new ceiling was added for this feature, and asking for
 * more would silently come back as 90 anyway.
 *
 * RING_DAYS (7) is deliberately NOT part of this union: the ring tiles read a
 * single latest-scored day rather than charting a range, so the toggle has
 * nothing to change about them (ROADMAP 4.14's out-of-scope note).
 */
export type RangeDays = 30 | 90;

const DEFAULT_RANGE_DAYS: RangeDays = 30;

/** localStorage key for the toggle's persisted selection. */
const RANGE_STORAGE_KEY = 'whoop-dashboard:range-days';

/**
 * Persisted range, read once for the initial render. ANY malformed value —
 * absent key, non-numeric, a number outside the union, or a throwing
 * localStorage (Safari private mode, storage disabled) — falls back to 30
 * rather than propagating. A dashboard window is not worth a blank screen.
 */
function readStoredRangeDays(): RangeDays {
  try {
    const raw = window.localStorage.getItem(RANGE_STORAGE_KEY);
    return raw !== null && Number(raw) === 90 ? 90 : DEFAULT_RANGE_DAYS;
  } catch {
    return DEFAULT_RANGE_DAYS;
  }
}

/** Persist the selection. Swallows storage failures — same reasoning as above. */
function storeRangeDays(days: RangeDays): void {
  try {
    window.localStorage.setItem(RANGE_STORAGE_KEY, String(days));
  } catch {
    // Storage unavailable/full: the selection still applies for this session,
    // it just won't survive a reload. Not worth surfacing.
  }
}

/**
 * Toggle options. Labels are CALENDAR-MONTH language ("1 month" / "3 months")
 * while the values are exact day counts — 30 and 90 are approximations of a
 * month and a quarter, and the tiles' own copy still names the true window
 * ("last 90 days"), so nothing claims a precision it doesn't have.
 */
const RANGE_OPTIONS: readonly RangeToggleOption<RangeDays>[] = [
  { value: 30, label: '1 month' },
  { value: 90, label: '3 months' },
];

/**
 * Full-width combo-chart row below the bento grid (same "Layout gap" decision
 * as SleepStagesTile — chart 4.2 has no bento slot). Drives ChartContainer's
 * status from the fetch state. Receives the shared series from App
 * (4.11 lifted the fetch — SkinTempTile reads the same rows, and a per-tile
 * hook here would double-fetch them, the 4.9 rule), plus the selected
 * `rangeDays` so its copy names the window actually fetched (4.14).
 */
function RecoveryStrainTile({
  series,
  rangeDays,
}: {
  series: DailySeriesState;
  rangeDays: RangeDays;
}) {
  const points = series.status === 'ready' ? series.points : [];
  // buildDailySeries emits a point for EVERY day in the window (all-null on
  // dataless days), so unlike sleep-stages `points.length === 0` never means
  // "no data" here — empty is "no day carries either plotted metric".
  const hasData = points.some((p) => p.recoveryScore != null || p.strain != null);
  const status: ChartStatus =
    series.status === 'unauthenticated' || (series.status === 'ready' && !hasData)
      ? 'empty'
      : series.status;
  return (
    <ChartContainer
      title="Recovery vs. strain"
      subtitle={`Recovery % (left axis) and day strain (right axis) — last ${rangeDays} days`}
      status={status}
      loadingLabel="Loading your recovery and strain…"
      emptyMessage={
        series.status === 'unauthenticated'
          ? 'Connect your WHOOP account to see your recovery and strain.'
          : `No recovery or strain data in the last ${rangeDays} days — run a sync, then refresh.`
      }
      errorMessage="Couldn’t load recovery and strain. Refresh to try again."
    >
      <RecoveryStrainComboChart
        data={points}
        title="Recovery vs. strain"
        tableCaption={`Daily recovery percent and day strain, last ${rangeDays} days`}
      />
    </ChartContainer>
  );
}

// --- Phase 4.3 — HRV over rolling-baseline combo tile ----------------------

/**
 * Bento HRV tile (§4, chart-3 slot): actual daily HRV as a line over its own
 * 7-day trailing rolling baseline as an area. Shares App's single fetch with
 * the other tiles (the 4.9 rule against per-tile duplicate fetches).
 *
 * The 7-day ROLLING baseline inside the chart is independent of the 4.14
 * range toggle: it's a smoothing window over the plotted series, not the
 * series' extent. Widening the range to 90 days plots more points, each still
 * smoothed against its own preceding week.
 *
 * Status mapping matches RecoveryStrainTile EXACTLY (NOT SkinTempTile's): 401
 * or a ready fetch with no HRV in the window → 'empty'; loading/error pass
 * through. Unlike skin temp — where all-null is the normal pre-4.0-hardware
 * case — a window with zero scored HRV means there's genuinely nothing to
 * show, so the connect/no-data empty state is the honest read.
 * (buildDailySeries emits a point for every day, so `points.length === 0` is
 * never the "no data" signal.)
 */
function HrvBaselineTile({
  series,
  rangeDays,
}: {
  series: DailySeriesState;
  rangeDays: RangeDays;
}) {
  const points = series.status === 'ready' ? series.points : [];
  const hasData = points.some((p) => p.hrvRmssdMilli != null);
  const status: ChartStatus =
    series.status === 'unauthenticated' || (series.status === 'ready' && !hasData)
      ? 'empty'
      : series.status;
  return (
    <ChartContainer
      className="bento-hrv"
      title="HRV over time"
      status={status}
      loadingLabel="Loading your HRV…"
      emptyMessage={
        series.status === 'unauthenticated'
          ? 'Connect your WHOOP account to see your HRV.'
          : `No HRV data in the last ${rangeDays} days — run a sync, then refresh.`
      }
      errorMessage="Couldn’t load HRV. Refresh to try again."
      legend={
        <>
          <span className="legend-item">
            <span
              className="legend-swatch legend-swatch-plain legend-swatch-actual"
              aria-hidden="true"
            />
            Actual HRV
          </span>
          <span className="legend-item">
            {/* Rolling baseline, NOT a population "ideal" band (that's deferred
                to Phase 5) — the swatch keeps the chart-4 --color-chart-4 token,
                the label tells the honest story. */}
            <span
              className="legend-swatch legend-swatch-plain legend-swatch-ideal"
              aria-hidden="true"
            />
            Recent baseline
          </span>
        </>
      }
    >
      <HrvBaselineComboChart
        data={points}
        title="HRV over time"
        tableCaption={`Daily HRV in ms with a 7-day rolling baseline, last ${rangeDays} days`}
      />
    </ChartContainer>
  );
}

// --- Phase 4.15 — RHR-over-rolling-baseline combo chart tile ---------------

/**
 * Bento RHR tile (§4: `restingHeartRate`, chart-7 actual / chart-4 baseline —
 * the RHR sibling of 4.3's HRV chart, same shared token pair per design.md
 * §1's "HRV/RHR sharing" note). Replaces the static `.combo-chart-placeholder`
 * that previously rendered here with legend copy that read "Ideal RHR" — that
 * copy was never accurate (no population study backs it; design.md §4's
 * locked ideal-band methodology is deferred to Phase 5) and is corrected to
 * "Recent baseline" here, matching 4.3's HRV tile precedent exactly.
 *
 * Status mapping matches HrvBaselineTile/RecoveryStrainTile EXACTLY (NOT
 * SkinTempTile's): 401 or a ready fetch with no RHR in the window → 'empty';
 * loading/error pass through. Unlike skin temp, a window with zero scored RHR
 * means there's genuinely nothing to show, so the connect/no-data empty state
 * is the honest read. (buildDailySeries emits a point for every day, so
 * `points.length === 0` is never the "no data" signal.)
 */
function RhrBaselineTile({
  series,
  rangeDays,
}: {
  series: DailySeriesState;
  rangeDays: RangeDays;
}) {
  const points = series.status === 'ready' ? series.points : [];
  const hasData = points.some((p) => p.restingHeartRate != null);
  const status: ChartStatus =
    series.status === 'unauthenticated' || (series.status === 'ready' && !hasData)
      ? 'empty'
      : series.status;
  return (
    <ChartContainer
      className="bento-rhr"
      title="RHR over time"
      status={status}
      loadingLabel="Loading your RHR…"
      emptyMessage={
        series.status === 'unauthenticated'
          ? 'Connect your WHOOP account to see your RHR.'
          : `No RHR data in the last ${rangeDays} days — run a sync, then refresh.`
      }
      errorMessage="Couldn’t load RHR. Refresh to try again."
      legend={
        <>
          <span className="legend-item">
            <span
              className="legend-swatch legend-swatch-plain legend-swatch-actual"
              aria-hidden="true"
            />
            Actual RHR
          </span>
          <span className="legend-item">
            {/* Rolling baseline, NOT a population "ideal" band (that's deferred
                to Phase 5) — the swatch keeps the chart-4 --color-chart-4 token,
                the label tells the honest story (4.3 precedent). */}
            <span
              className="legend-swatch legend-swatch-plain legend-swatch-ideal"
              aria-hidden="true"
            />
            Recent baseline
          </span>
        </>
      }
    >
      <RhrBaselineComboChart
        data={points}
        title="RHR over time"
        tableCaption={`Daily RHR in BPM with a 7-day rolling baseline, last ${rangeDays} days`}
      />
    </ChartContainer>
  );
}

// --- Phase 5.5 — hydration-vs-recovery correlation tile --------------------

/**
 * Full-width row below the bento grid (design.md §2's "Layout gap" decision:
 * a Phase 4/5 chart with no bento slot gets its own row at the dashboard's
 * 1200px column width — the SleepStagesTile / RecoveryStrainTile precedent).
 *
 * PLACEMENT, chosen deliberately over the alternative in the 5.5 brief: there
 * is no free "bento-strain / chart-6" slot to fill. `bento-strain` is occupied
 * by the real 4.9 strain ring, and design.md §4's chart-6 row is a MAPPING row
 * in the chart table (the strain-matrix option it locked in 2026-07-09,
 * explicitly "since Phase 5 does not exist yet"), not an empty grid area — the
 * bento's `grid-template-areas` (§2, Figma-confirmed) has nine areas and all
 * nine are filled. Adding a tenth would edit that locked layout, which is a
 * design call, not this task's. A full-width row is also the honest shape for
 * this chart: 30–90 day columns need the width, and the 5.2 journal tile
 * already showed what a wide-content tile does to the 640px grid.
 *
 * Fed App's SHARED `useDailySeries(rangeDays)` — the same call that already
 * feeds five other tiles. No new endpoint and no second fetch (4.3/4.15 rule);
 * `hydrated` rides along on the points those tiles already receive.
 *
 * Status mapping matches RecoveryStrainTile EXACTLY: 401 → 'empty' (the 4.9
 * rule), loading/error pass through, and a ready fetch where no day in the
 * window carries EITHER a recovery score or a hydration answer → 'empty'.
 * A window with recovery but no journal answers is NOT empty — that is the
 * informative "nothing logged yet" state, and the chart says so in its own
 * summary line rather than hiding behind a tile-level empty state.
 */
function HydrationRecoveryTile({
  series,
  rangeDays,
}: {
  series: DailySeriesState;
  rangeDays: RangeDays;
}) {
  const points = series.status === 'ready' ? series.points : [];
  // `!= null` and not a truthiness check: an answered `hydrated: false` is a
  // real answer and must keep this tile out of its empty state.
  const hasData = points.some((p) => p.recoveryScore != null || p.hydrated != null);
  const status: ChartStatus =
    series.status === 'unauthenticated' || (series.status === 'ready' && !hasData)
      ? 'empty'
      : series.status;
  return (
    <ChartContainer
      title="Hydration vs. recovery"
      subtitle={`One dot per day — dot height is your recovery zone, dot color is what you logged for hydration (last ${rangeDays} days)`}
      status={status}
      loadingLabel="Loading your hydration and recovery…"
      emptyMessage={
        series.status === 'unauthenticated'
          ? 'Connect your WHOOP account to compare your journal against your recovery.'
          : `No recovery or journal data in the last ${rangeDays} days — run a sync and log a day, then refresh.`
      }
      errorMessage="Couldn’t load hydration and recovery. Refresh to try again."
      legend={
        /* Three entries, one per hydration state — hue is the hydration channel
           now, so the legend explains hue and nothing else. Recovery is NOT in
           the legend on purpose: it is the vertical axis, already labelled in
           real text on every row ("67–100%"), and a swatch for it would imply a
           color it no longer has. Swatch colors come from HYDRATION_COLORS, the
           same constant the dots are filled from, so the two cannot drift.
           `.legend-swatch`'s muted hairline is what carries chart-1 and
           --color-border past the 3:1 non-text threshold (§5.2 rule 4). */
        <>
          {/* Mapped from HYDRATION_STATES so the three entries stay in one
              declared order and can never fall out of step with the dots. */}
          {HYDRATION_STATES.map((state) => (
            <span key={state} className="legend-item">
              <span
                className="legend-swatch"
                aria-hidden="true"
                style={{ background: HYDRATION_COLORS[state] }}
              />
              {HYDRATION_LABELS[state]}
            </span>
          ))}
          {/* The non-hue channel, named in real text — a swatch can't show a
              radius, and rule 4 forbids leaving the answer to hue alone. */}
          <span className="legend-item">
            Dot size repeats it: large = hydrated, small = dehydrated
          </span>
        </>
      }
    >
      {/* tableCaption is kept to the same short length as every other chart's
          on purpose: `.sr-only-table` is clipped but still LAID OUT, so a long
          nowrap caption widens the whole page (measured: a 984px caption pushed
          document.scrollWidth to 1020 at a 690px viewport). What "no data"
          means in each column rides in the SVG <desc> instead. */}
      <HydrationRecoveryDotMatrix
        data={points}
        title="Hydration vs. recovery"
        tableCaption={`Hydration logged and WHOOP recovery per day, last ${rangeDays} days`}
      />
    </ChartContainer>
  );
}

// --- Phase 4.11 — skin-temp sparkline tile ---------------------------------

/**
 * Bento skin-temp tile (§4: `skin_temp_celsius`, chart-3 sparkline). Shares
 * App's single fetch with RecoveryStrainTile (the 4.9 rule against per-tile
 * duplicate fetches of identical rows), and its copy names the 4.14-selected
 * window.
 *
 * Status mapping deliberately DIVERGES from RecoveryStrainTile's: ready with
 * all-null skin temps is NOT mapped to 'empty' — null is the NORMAL case on
 * pre-4.0 hardware (the strap has no temp sensor), and 'empty' would read as
 * a broken connection. It falls through to the Sparkline's own noData state,
 * whose caption names the likely reason. Per the 4.9 rule, 'empty' means
 * 401/no session only. (buildDailySeries emits a point for every day in the
 * window, so `points.length === 0` never means "no data" either.)
 */
function SkinTempTile({ series, rangeDays }: { series: DailySeriesState; rangeDays: RangeDays }) {
  const points = series.status === 'ready' ? series.points : [];
  const status: ChartStatus = series.status === 'unauthenticated' ? 'empty' : series.status;
  // No bodyHeight on the container: the Sparkline owns its 64px plot height
  // plus the value line, per ChartContainer's "Phase 4's responsive D3 charts
  // drop the prop" guidance.
  return (
    <ChartContainer
      className="bento-skintemp"
      title="Skin temp over time"
      status={status}
      loadingLabel="Loading your skin temperature…"
      emptyMessage="Connect your WHOOP account to see your skin temperature."
      errorMessage="Couldn’t load skin temperature. Refresh to try again."
    >
      <Sparkline
        data={points}
        title="Skin temp over time"
        tableCaption={`Daily skin temperature in °C, last ${rangeDays} days`}
        noDataCaption={`no readings in the last ${rangeDays} days — skin temp needs WHOOP 4.0 or newer`}
      />
    </ChartContainer>
  );
}

// --- Phase 4.12 — Calories & Sleep stat cards ------------------------------

/**
 * BASELINE WINDOW for the stat-card deltas — as of 4.14 no longer a constant.
 * The old `BASELINE_WINDOW_DAYS = RECOVERY_STRAIN_DAYS` is gone; both stat
 * tiles now pass their `rangeDays` prop straight through as baselineDelta's
 * `windowDays`, so "your recent average" means "the average over whatever
 * window is currently selected" — pick 3 months and the delta is measured
 * against a 3-month baseline. It still reads App's single shared fetch (a
 * second useDailySeries call over an identical window would violate the 4.9
 * no-duplicate-fetch rule).
 *
 * The window is [today−(n−1), today] inclusive; baselineDelta EXCLUDES today
 * from the mean (decision 3), so the baseline is the ≤n−1 PRIOR non-null days.
 * We deliberately do NOT bump the fetch by one to compensate: `rangeDays` is
 * load-bearing for 4.2's and 4.11's "last N days" copy, and changing it would
 * silently rewrite their captions. The visible delta caption therefore says
 * "your recent average", never an exact day count.
 *
 * Minimum non-null PRIOR days before a delta is shown. 10 is deliberately
 * STRICTER than buildRollingBaseline's DEFAULT_MIN_SAMPLES = 3 (decision 2):
 * 3 was tuned for a SMOOTHED line, where a thin early window is visually
 * forgiving — but a headline "312 cal above your average" computed off 3 days
 * would be dishonest. Below 10 the card shows the day's value with a "not
 * enough history yet" caption and NO delta.
 *
 * This floor stays FIXED at 10 across both ranges (4.14 decision) — it is a
 * floor on statistical confidence, not a fraction of the window. Scaling it
 * with the range (e.g. 30 samples at 90 days) would make the 3-month view go
 * BLANK for exactly the users with sparse history who benefit most from a
 * longer lookback, while 10 real days is no less trustworthy a mean because
 * the window around it got wider.
 */
const BASELINE_MIN_SAMPLES = 10;

/**
 * Kilojoules per kilocalorie. WHOOP's API returns raw `kilojoule`; the app
 * shows kcal ("Calories"), so we convert (RECOVERY_ZONES citation precedent).
 *
 * 4.184 is the THERMOCHEMICAL calorie — NIST: "cal_th = 4.184 J exactly"
 * (https://www.nist.gov/pml/special-publication-811/nist-guide-si-footnotes,
 * fetched 2026-07-19) — which is the convention dietary / "food" Calories use.
 * The International-Table calorie is 4.1868 J, ~0.1% larger.
 *
 * WHOOP does NOT publish which calorie their displayed figure means: checked
 * developer.whoop.com (whoop-101, workout-data endpoint) and WHOOP support on
 * 2026-07-19 — their docs describe a proprietary BMR + heart-rate model and
 * give no kJ→kcal factor. We ship 4.184 because it matches the nutritional
 * convention and the ~0.1% gap is far below WHOOP's own calorie-estimate error;
 * if WHOOP ever states otherwise, this single constant is the place to change.
 */
const KJ_PER_KCAL = 4.184;

/** Round millis to whole minutes, round-half-up — the transforms millisToMinutes precedent. */
function millisToMinutesRounded(milli: number): number {
  return Math.round(milli / 60_000);
}

/** Total sleep millis → "7:32 hrs" (whole minutes round-half-up, then h:mm). */
function formatSleepValue(milli: number): string {
  const minutes = millisToMinutesRounded(milli);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}:${String(mins).padStart(2, '0')} hrs`;
}

/** Kilojoules → whole kcal integer (thermochemical calorie, KJ_PER_KCAL). */
function kilojoulesToKcal(kilojoule: number): number {
  return Math.round(kilojoule / KJ_PER_KCAL);
}

/** kcal integer with thousands grouping → "2,384 cal" (fixed en-US, deterministic). */
function formatCaloriesValue(kilojoule: number): string {
  return `${kilojoulesToKcal(kilojoule).toLocaleString('en-US')} cal`;
}

/**
 * Fetch state → ChartContainer status for the stat tiles. Mirrors SkinTempTile
 * EXACTLY: 401 → empty (connect-WHOOP); loading/error pass through; a ready
 * fetch with genuinely-absent data does NOT map to empty — it falls through to
 * StatDelta's own no-value/no-baseline state, since `empty` means "no session,"
 * not "no rows" (the 4.9/4.11 rule). buildDailySeries emits a point for every
 * day in the window, so points.length is never the "no data" signal here.
 */
function statTileStatus(series: DailySeriesState): ChartStatus {
  return series.status === 'unauthenticated' ? 'empty' : series.status;
}

/**
 * Most recent day (scanning backward from the end of `points`) whose `metric`
 * is non-null, returned as the series SLICED to end on that day — so a
 * downstream `baselineDelta` call treats that day as "today" and correctly
 * excludes it from its own trailing baseline. `null` only when NO day in the
 * whole fetched window has a value (never synced / brand-new account).
 *
 * Mirrors `latestScored`'s backward scan (the Recovery/Strain ring precedent,
 * below) but returns a slice instead of a single point, since the caller needs
 * a full sub-series to compute a baseline against, not just a headline number.
 */
function latestScoredSlice<T extends { day: string }>(
  points: readonly T[],
  metric: (p: T) => number | null,
): readonly T[] | null {
  for (let i = points.length - 1; i >= 0; i--) {
    if (metric(points[i]) != null) {
      return points.slice(0, i + 1);
    }
  }
  return null;
}

/**
 * Bento sleep stat card (§4). Total sleep = the STAGE SUM (light + deep + REM),
 * already shaped as DailyMetricPoint.totalSleepMilli (decision 1 — NOT
 * total_in_bed − awake: naps are already excluded upstream, it matches chart
 * 4.1's stacked bar, and one shipped definition beats a second competing one).
 * Value in h:mm, delta in whole minutes vs. the trailing baseline. Shares App's
 * 30-day fetch via a prop — no second useDailySeries call.
 *
 * FALLBACK (changed 2026-07-21, at your direction): unlike Calories, Sleep
 * does NOT strictly require the calendar-today row. WHOOP scores sleep and
 * Recovery from the same overnight session at the same moment on waking, and
 * both are already fetched in the identical daily sync pass — so Sleep now
 * scans backward for the latest scored night exactly like `latestScored` does
 * for the Recovery/Strain rings below, instead of going blank whenever the
 * sync for today's calendar date hasn't landed yet. Calories deliberately
 * keeps the strict today-only check: it accrues live through the day, so
 * today being null there is a genuinely different, still-true state, not just
 * a sync-lag artifact.
 * DISCLOSURE (added 2026-07-21): when the fallback reaches past
 * calendar-today, the tile shows a visible `formatRingDay`-labeled "As of
 * [date]" line (StatDelta's `asOfLabel`) — closing the gap the earlier
 * version of this comment flagged, and giving Sleep the same day-honesty the
 * rings already had (their `<desc>`), just visible instead of aria-only,
 * since StatDelta has no desc channel to put it in.
 */
function SleepStatTile({ series, rangeDays }: { series: DailySeriesState; rangeDays: RangeDays }) {
  const points = series.status === 'ready' ? series.points : [];
  const sleepPoints = latestScoredSlice(points, (p) => p.totalSleepMilli);
  const delta = sleepPoints
    ? baselineDelta(sleepPoints, (p) => p.totalSleepMilli, {
        windowDays: rangeDays,
        minSamples: BASELINE_MIN_SAMPLES,
        excludeToday: true,
      })
    : ({ kind: 'no-value' } as const);
  // "Today" per the SHARED series (what Calories/every other tile treats as
  // today) vs. the day the sleep fallback actually landed on. Only differ
  // when the scan above had to reach backward — the common on-time case
  // stays silent (asOfLabel undefined), matching StatDelta's default.
  const trueToday = points.length > 0 ? points[points.length - 1].day : null;
  const sleepDay = sleepPoints ? sleepPoints[sleepPoints.length - 1].day : null;
  const asOfLabel =
    sleepDay && sleepDay !== trueToday ? `As of ${formatRingDay(sleepDay)}` : undefined;
  return (
    <ChartContainer
      className="bento-sleep"
      title="Sleep"
      status={statTileStatus(series)}
      loadingLabel="Loading your sleep…"
      emptyMessage="Connect your WHOOP account to see your sleep."
      errorMessage="Couldn’t load sleep. Refresh to try again."
    >
      <StatDelta
        delta={delta}
        formatValue={formatSleepValue}
        deltaToDisplay={millisToMinutesRounded}
        deltaUnit="min"
        noValueCaption="no sleep recorded yet"
        noBaselineCaption="not enough history yet for an average"
        asOfLabel={asOfLabel}
      />
    </ChartContainer>
  );
}

/**
 * Bento calories stat card (§4). `kilojoule` from the day's cycle (added to
 * DailyMetricPoint in 4.12), converted to a whole kcal integer via KJ_PER_KCAL.
 * Value and delta both in kcal. Shares App's fetch via a prop, and takes the
 * 4.14-selected `rangeDays` as its baseline window.
 */
function CaloriesStatTile({
  series,
  rangeDays,
}: {
  series: DailySeriesState;
  rangeDays: RangeDays;
}) {
  const points = series.status === 'ready' ? series.points : [];
  const delta = baselineDelta(points, (p) => p.kilojoule, {
    windowDays: rangeDays,
    minSamples: BASELINE_MIN_SAMPLES,
    excludeToday: true,
  });
  return (
    <ChartContainer
      className="bento-calories"
      title="Calories"
      status={statTileStatus(series)}
      loadingLabel="Loading your calories…"
      emptyMessage="Connect your WHOOP account to see your calories."
      errorMessage="Couldn’t load calories. Refresh to try again."
    >
      <StatDelta
        delta={delta}
        formatValue={formatCaloriesValue}
        deltaToDisplay={kilojoulesToKcal}
        deltaUnit="cal"
        noValueCaption="today’s calories aren’t in yet"
        noBaselineCaption="not enough history yet for an average"
      />
    </ChartContainer>
  );
}

// --- Phase 4.9 — recovery/strain progress-ring tiles -----------------------

/**
 * Window for the ring tiles' shared fetch. WIDENED from 7 to 90 days on
 * 2026-08-01: the rings still headline a single "latest scored day" (7 days was
 * plenty of lookback for that), but each now also shows a 1-month AND a 3-month
 * trailing average of its own metric, and a 3-month average cannot be computed
 * from a 7-day window.
 *
 * 90 rather than a third fetch: this is the SAME series the rings already read,
 * so widening it costs one larger response instead of adding a request (the 4.9
 * no-duplicate-fetch rule). It is deliberately NOT wired to `rangeDays` — the
 * two trailing windows below are fixed periods the toggle must not move, or
 * "your 3-month average" would silently mean 30 days.
 *
 * KNOWN COST, flagged: when the toggle sits on "3 months" this request and
 * App's range-driven one ask for the identical `?days=90`, so the browser
 * issues two equivalent GETs. The request COUNT is unchanged from before this
 * pass (it has always been two), and de-duplicating them would mean collapsing
 * the rings and the range-driven tiles onto one fetch — a change to the
 * confirmed 4.14 toggle behavior, which is out of scope here.
 */
const RING_DAYS = 90;

/**
 * The two trailing windows the ring tiles compare today against. Day counts,
 * with labels that say "month" — the same approximation RANGE_OPTIONS already
 * makes for the toggle, and the labels never claim an exact day count.
 */
const RING_TREND_WINDOWS = [
  { days: 30, label: '1-month average' },
  { days: 90, label: '3-month average' },
] as const;

/**
 * Non-null prior days required before a ring shows a trailing comparison.
 * Matches BASELINE_MIN_SAMPLES (10) and for the same reason: a headline
 * "12% above your average" computed off three days would be dishonest. It
 * stays FIXED across both windows — a floor on confidence, not a fraction of
 * the window (the 4.14 decision).
 */
const RING_TREND_MIN_SAMPLES = BASELINE_MIN_SAMPLES;

/**
 * Both trailing comparisons for one ring metric, in RING_TREND_WINDOWS order.
 *
 * Uses `baselineDelta` (src/lib/stats.ts), NOT `buildRollingBaseline`
 * (api/_lib/transforms.ts) — FLAGGED, since the brief named the latter. They
 * are two halves of the same trailing-average infrastructure and this is the
 * half built for this exact question: `baselineDelta` compares ONE headline
 * value against the mean of the prior days in a trailing window, EXCLUDES that
 * day from its own baseline (a day must not inflate the average it is measured
 * against), and gates on a minimum sample count. `buildRollingBaseline` emits a
 * smoothed mean for EVERY day and deliberately INCLUDES the current day —
 * correct for the HRV/RHR baseline areas it feeds, wrong for "today vs. my
 * normal". Its own module header spells out that divergence.
 */
function ringTrends(
  points: readonly DailyMetricPoint[],
  metric: (p: DailyMetricPoint) => number | null,
): BaselineDelta[] {
  // Slice to end on the latest SCORED day so baselineDelta treats that day as
  // "today" — otherwise an unscored today reads as `no-value` and the ring
  // would show a number with no comparison beside it.
  const scored = latestScoredSlice(points, metric);
  if (!scored) {
    return RING_TREND_WINDOWS.map(() => ({ kind: 'no-value' }) as const);
  }
  return RING_TREND_WINDOWS.map((window) =>
    baselineDelta(scored, metric, {
      windowDays: window.days,
      minSamples: RING_TREND_MIN_SAMPLES,
      excludeToday: true,
    }),
  );
}

/** The two trailing-average lines under a ring, rendered in window order. */
function RingTrends({ trends }: { trends: BaselineDelta[] }) {
  return (
    <div className="ring-trends">
      {RING_TREND_WINDOWS.map((window, i) => (
        <TrendIndicator key={window.days} delta={trends[i]} windowLabel={window.label} />
      ))}
    </div>
  );
}

/**
 * WHOOP recovery zones (verified cutoffs + their fill-safe hues) MOVED to
 * `src/lib/recovery.ts` in 5.5 — the hydration/recovery dot matrix rows and
 * colors its dots by the same zones, and one dashboard must not hold two
 * definitions of "green". Imported above; nothing about the values changed.
 *
 * Strain's scale ceiling — 0–21 Borg scale, same whoop-101 doc the zones cite.
 * Stays here: the strain ring is its only consumer.
 */
const STRAIN_SCALE_MAX = 21;

const ringDayFormat = utcFormat('%B %-d, %Y');

/** Format YYYY-MM-DD via a UTC formatter (no local-zone day shift). */
function formatRingDay(day: string): string {
  const date = new Date(day);
  return Number.isNaN(date.getTime()) ? day : ringDayFormat(date);
}

/**
 * Most recent point whose metric is non-null. buildDailySeries emits points
 * ascending, one per day, all-null on dataless days — so scanning from the
 * end lands on the latest SCORED day and skips a PENDING_SCORE/UNSCORABLE
 * today automatically (the Phase 2 null discipline at work).
 */
function latestScored(
  points: readonly DailyMetricPoint[],
  metric: (p: DailyMetricPoint) => number | null,
): { day: string; value: number } | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const value = metric(points[i]);
    if (value != null) {
      return { day: points[i].day, value };
    }
  }
  return null;
}

/**
 * Fetch-state → ChartContainer status for the ring tiles. Unlike the
 * full-width charts, `ready` with no scored day is NOT mapped to 'empty' —
 * the ring renders its own noData state (bare track + "—"), mirroring the
 * pre-4.9 placeholder.
 */
function ringStatus(series: DailySeriesState): ChartStatus {
  return series.status === 'unauthenticated' ? 'empty' : series.status;
}

/**
 * Bento recovery tile (§4: `recovery_score` 0–100, zone-colored ring).
 * Both ring tiles receive the SAME series from one useDailySeries call in
 * App — they read different fields of identical rows, and per-tile hooks
 * (the SleepStagesTile pattern) would issue two identical fetches. The same
 * rule drives App's second, range-driven fetch, shared by RecoveryStrainTile
 * and SkinTempTile (4.11); RING_DAYS stays its OWN window (90 days as of
 * 2026-08-01) because the ring trends are fixed periods the toggle must not
 * move — see RING_DAYS.
 *
 * Below the ring: a 1-month and a 3-month trailing average of RECOVERY, with
 * the same ▲/▼ indicator the Sleep stat tile uses (TrendIndicator).
 */
function RecoveryRingTile({ series }: { series: DailySeriesState }) {
  const points = series.status === 'ready' ? series.points : [];
  const latest = series.status === 'ready' ? latestScored(points, (p) => p.recoveryScore) : null;
  const zone = latest ? recoveryZone(latest.value) : null;
  // Recovery compared against RECOVERY's own trailing averages. The two ring
  // tiles never cross-wire: each reads the field it displays.
  const trends = ringTrends(points, (p) => p.recoveryScore);
  return (
    <ChartContainer
      className="bento-recovery"
      title="Recovery"
      status={ringStatus(series)}
      loadingLabel="Loading your recovery…"
      emptyMessage="Connect your WHOOP account to see your recovery."
      errorMessage="Couldn’t load recovery. Refresh to try again."
    >
      {latest && zone ? (
        <ProgressRing
          fraction={latest.value / 100}
          title="Recovery"
          desc={`${Math.round(latest.value)} percent, ${zone.name} zone, ${formatRingDay(latest.day)}.`}
          valueLabel={`${Math.round(latest.value)}%`}
          progressColor={zone.color}
        />
      ) : (
        <ProgressRing fraction={0} noData title="Recovery" desc="No data yet." valueLabel="—" />
      )}
      <RingTrends trends={trends} />
    </ChartContainer>
  );
}

/** Bento strain tile (§4: `strain` on WHOOP's 0–21 scale, chart-5 azure). */
function StrainRingTile({ series }: { series: DailySeriesState }) {
  const points = series.status === 'ready' ? series.points : [];
  const latest = series.status === 'ready' ? latestScored(points, (p) => p.strain) : null;
  // Strain vs. STRAIN's own averages — never recovery's.
  const trends = ringTrends(points, (p) => p.strain);
  return (
    <ChartContainer
      className="bento-strain"
      title="Strain"
      status={ringStatus(series)}
      loadingLabel="Loading your strain…"
      emptyMessage="Connect your WHOOP account to see your strain."
      errorMessage="Couldn’t load strain. Refresh to try again."
    >
      {latest ? (
        <ProgressRing
          fraction={latest.value / STRAIN_SCALE_MAX}
          title="Strain"
          desc={`${latest.value.toFixed(1)} of ${STRAIN_SCALE_MAX} day strain, ${formatRingDay(latest.day)}.`}
          valueLabel={latest.value.toFixed(1)}
          progressColor="var(--color-chart-5)"
        />
      ) : (
        <ProgressRing fraction={0} noData title="Strain" desc="No data yet." valueLabel="—" />
      )}
      <RingTrends trends={trends} />
    </ChartContainer>
  );
}

/** Today as a local 'YYYY-MM-DD' — the calendar day the user is living in. */
function localTodayISO(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Bento period tile (§4: dot-matrix cycle-day meter; self-reported — the
 * WHOOP v2 API has no menstrual-cycle resource). PHASE 5 SEAM: when the daily
 * journal ships its tri-state "Period" field, pass the full log history (and
 * the once-asked typical cycle length) as props — the three cycleState kinds
 * below already render. Until then `logs` defaults to [] and the tile
 * honestly resolves to 'no-data'. No fetch happens here, so ChartContainer
 * stays in its default 'ready' status: per the 4.9 rule, 'empty' means
 * 401/no session, and a successful-but-dataless render is the component's
 * own no-data state.
 */
function PeriodMeterTile({
  logs = [],
  typicalCycleLength = null,
}: {
  logs?: PeriodLog[];
  typicalCycleLength?: number | null;
}) {
  const state = cycleState(logs, localTodayISO(), typicalCycleLength);
  // TODO(design.md §4 limitation #6): once real journal data flows in, surface
  // the inference caveat in the UI — episode starts are inferred from daily
  // checkboxes, so a >3-day spotting gap inside one real period reads as a new
  // cycle. Don't ship silent inference; the manual "mark as new cycle start"
  // override remains a Phase 5+ enhancement.
  return (
    <ChartContainer className="bento-period" title="Cycle day">
      {state.kind === 'no-data' && (
        // The 28-dot track is DECORATIVE continuity with the old placeholder
        // strip — every dot is track-colored, nothing is filled, and no cycle
        // length is being claimed; the desc/caption say why there's no data.
        <DotMatrix
          total={28}
          filled={0}
          noData
          title="Cycle day"
          desc="No data yet: cycle day comes from the daily journal's Period field, which isn't built yet (Phase 5)."
          valueLabel="—"
          caption="no data yet — the Phase 5 journal isn't built"
        />
      )}
      {state.kind === 'day-only' && (
        // A start date but no cycle length (no second episode, no user-reported
        // value): text only. Never an assumed 28-dot denominator (user
        // decision 2026-07-18 — Phase 5 asks for typical length once, on the
        // first logged period).
        <p className="dot-matrix-value">Day {state.dayOfCycle}</p>
      )}
      {state.kind === 'full' && (
        <DotMatrix
          total={state.cycleLength}
          filled={state.dayOfCycle}
          title="Cycle day"
          desc={`Day ${state.dayOfCycle} of ${
            state.lengthSource === 'estimated' ? 'an estimated' : 'your reported'
          } ${state.cycleLength}-day cycle.`}
          valueLabel={
            state.dayOfCycle > state.cycleLength
              ? `Day ${state.dayOfCycle} of ${
                  state.lengthSource === 'estimated' ? 'an estimated' : 'your reported'
                } ${state.cycleLength}-day cycle`
              : `Day ${state.dayOfCycle} of ${state.cycleLength}`
          }
        />
      )}
    </ChartContainer>
  );
}

/* `journalAnswersEqual` lived here through 5.4 and was REMOVED 2026-08-01: its
 * only caller was handleSave's conditional `setAnswers`, which now
 * unconditionally adopts the stored row (see the comment there for why). Dead
 * code, deleted rather than left dangling — the 4.9-4.11 precedent for retired
 * helpers. */

/** User-facing reason a save failed, by response status. Deliberately vague
 *  about the server side (the API's own bodies are generic too) and specific
 *  about what the user can do next. */
function saveErrorMessage(status: number): string {
  if (status === 401) {
    return 'Your session expired — reconnect WHOOP, then save again.';
  }
  if (status === 503) {
    return 'The database is waking up. Try saving again in a moment.';
  }
  return "Couldn't save your journal. Try again.";
}

/**
 * Daily-journal tile (Phase 5.3 — storage). Owns the I/O that `JournalForm`
 * deliberately doesn't: it loads today's row on mount and upserts it on save,
 * both through `/api/journal`, which keys on `(user_id, day)` with the member
 * taken from the session cookie server-side.
 *
 * The loaded answers live in STATE so their reference stays stable across
 * renders — the form re-seeds itself whenever that reference (or `day`)
 * changes, so an object rebuilt inline here would wipe in-progress typing on
 * every keystroke elsewhere in the tree.
 *
 * Phase 5.4 adds the reminder layer on top, without touching either side of the
 * 5.2 seam: `useJournalReminder` reads the SAME mount-time GET below (no second
 * endpoint, no second request) and `JournalReminder` renders the opt-in / off
 * switch above the form. All of its rules live in `src/lib/reminder.ts`.
 *
 * TODO(5.3+) — the once-only "typical cycle length" prompt (ROADMAP 5.1
 * constraint 2) is still unbuilt and out of scope here: it writes
 * `user_settings` and must first READ `typical_cycle_length_asked_at`, so it
 * needs an endpoint that doesn't exist yet. See the TODO at the `period`
 * control in JournalForm.tsx; its answer goes into PeriodMeterTile's
 * `typicalCycleLength` prop UNRESOLVED (cycleState owns the precedence).
 *
 * ── PRESENTATION, reworked 2026-08-01 ───────────────────────────────────────
 * The tile no longer renders the form inline. It has TWO states:
 *
 *   not logged today → a "New entry" button. Pressing it opens a Tearsheet
 *                      that slides up from the bottom holding the SAME
 *                      `JournalForm`; "Save journal" writes through the same
 *                      handleSave below and closes, "Cancel" closes and throws
 *                      the in-progress input away.
 *   logged today     → `JournalSummary`, a READ-ONLY list of what was saved.
 *                      No editable controls.
 *
 * The tile keeps its `bento-journal` grid area in both states — nothing about
 * the layout moved. This is presentation only: `/api/journal`,
 * `journal-types.ts` and the 5.4 reminder layer are untouched, and the form is
 * still handed the same `day` / `initialAnswers` / `onSubmit` contract 5.2
 * defined.
 *
 * NO EDIT PATH FROM THE FILLED STATE — flagged. The brief specifies the logged
 * state as read-only "with no editable form controls" and puts "New entry"
 * only in the empty state, so that is what ships. It IS a change in
 * capability: `/api/journal` upserts on `(user_id, day)` and JournalForm
 * re-seeds from `initialAnswers`, so editing today still works end to end —
 * there is simply no longer a button that reaches it. Adding an "Edit entry"
 * action to the filled state would be a one-line change (open the same
 * tearsheet) if that turns out to be wanted.
 */
function JournalTile() {
  const day = localTodayISO();
  // Tearsheet visibility. `openCount` is the form's remount key: bumping it on
  // every open re-seeds JournalForm from `initialAnswers`, which is what makes
  // Cancel actually DISCARD — without it the form would keep whatever was
  // typed before the last dismissal and silently re-present it as the current
  // draft.
  const [open, setOpen] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const [answers, setAnswers] = useState<JournalAnswers | undefined>(undefined);
  // Does today's row EXIST? Deliberately not derived from `answers`: a saved
  // entry whose values match what was already on screen leaves `answers`
  // untouched (see handleSave), and an entry of all-nulls is a real logged day
  // that happens to look like a blank one. `null` = we don't know yet — the
  // reminder never guesses from that (5.4).
  const [logged, setLogged] = useState<boolean | null>(null);
  // 'empty' is the 4.9 no-session convention every other tile uses for a 401;
  // 'error' covers a failed/unparseable load (including the 503 waking case —
  // a reload once the database is back is enough for a tile).
  const [status, setStatus] = useState<ChartStatus>('loading');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Mount-time load, guarded by a cancellation flag like useSleepStages /
  // session-check: no setState after unmount, and no throw out of the effect.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/journal?day=${day}`);
        if (res.status === 401) {
          if (!cancelled) {
            setStatus('empty');
          }
          return;
        }
        if (!res.ok) {
          if (!cancelled) {
            setStatus('error');
          }
          return;
        }
        const body = (await res.json()) as { entry?: JournalAnswers | null };
        if (!cancelled) {
          // `entry: null` is the normal "nothing logged today yet" answer, not
          // a failure — the form opens blank, every field unanswered.
          setAnswers(body.entry ?? undefined);
          setLogged(body.entry != null);
          setStatus('ready');
        }
      } catch {
        // Network failure or an unparseable body (e.g. plain `vite dev`, which
        // serves no /api at all).
        if (!cancelled) {
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [day]);

  function openSheet() {
    setSubmitError(null);
    setOpenCount((n) => n + 1);
    setOpen(true);
  }

  /**
   * Every dismissal route (Cancel, ✕, Escape, backdrop) lands here. Closing is
   * all it does — the draft is discarded by the remount `openCount` forces on
   * the next open, never written anywhere.
   */
  function closeSheet() {
    setOpen(false);
    setSubmitError(null);
  }

  async function handleSave(next: JournalAnswers) {
    setSubmitting(true);
    setSubmitError(null);
    // Whichever failure fires below sets this before rethrowing; the default
    // covers a fetch that never produced a response at all.
    let message = "Couldn't save your journal. Check your connection and try again.";
    try {
      const res = await fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day, answers: next }),
      });
      if (!res.ok) {
        message = saveErrorMessage(res.status);
        throw new Error(`Journal save failed with status ${res.status}.`);
      }
      const body = (await res.json()) as { entry?: JournalAnswers | null };
      // The row as SAVED, falling back to the payload if the body is
      // unexpected. ALWAYS adopted as of 2026-08-01.
      //
      // Through 5.4 this was conditional — `journalAnswersEqual(stored, next)`
      // kept the previous reference, because handing JournalForm a new
      // `initialAnswers` made it re-seed and re-seeding cleared its "Saved."
      // status. That reasoning died with the tearsheet: a successful save
      // closes the sheet and unmounts the form, and the next open remounts it
      // fresh regardless. Keeping the old behavior would now be an outright
      // BUG — on a FIRST entry `prev` is `undefined`, so the tile would flip
      // `logged` to true while holding no answers to render, and fall back to
      // the "New entry" empty state immediately after a successful save.
      const stored = body.entry ?? next;
      setAnswers(stored);
      // The row now exists whatever it contains — 5.4's reminder must not fire
      // for a day the user just logged in this session.
      setLogged(true);
      // Only on success: a failed write rethrows below, so the sheet stays
      // open with the user's input and the error intact.
      setOpen(false);
    } catch (err) {
      setSubmitError(message);
      // Rethrow: JournalForm catches this and withholds its "Saved." status,
      // so a failed write never reads as a successful one.
      throw err;
    } finally {
      setSubmitting(false);
    }
  }

  // 5.4 — 'unknown' while loading, on a 401, and after a failed load: three
  // states in which we cannot honestly say the day is unlogged, so the reminder
  // stays silent in all of them.
  const dayStatus: JournalDayStatus =
    logged === null ? 'unknown' : logged ? 'logged' : 'not-logged';
  const reminder = useJournalReminder(dayStatus, day);

  return (
    <ChartContainer
      className="bento-journal"
      title="Daily journal"
      status={status}
      loadingLabel="Loading today’s journal…"
      emptyMessage="Connect your WHOOP account to log your day."
      errorMessage="Couldn’t load today’s journal. Refresh to try again."
    >
      {/* The reminder stays on the TILE, not in the tearsheet: it is a live
          region and the focus target a clicked notification lands on, so it
          has to be present whether or not the sheet is open (5.4 logic
          untouched). */}
      <JournalReminder
        prompt={reminder.prompt}
        regionRef={reminder.regionRef}
        onEnable={reminder.enable}
        onDismiss={reminder.dismiss}
        onDisable={reminder.disable}
      />

      {logged && answers ? (
        <JournalSummary day={day} answers={answers} />
      ) : (
        <div className="journal-empty">
          <p className="journal-hint">Nothing logged for today yet.</p>
          <Button type="button" size="sm" onClick={openSheet}>
            New entry
          </Button>
        </div>
      )}

      <Tearsheet open={open} title="Daily journal" onClose={closeSheet}>
        <JournalForm
          key={openCount}
          day={day}
          initialAnswers={answers}
          onSubmit={handleSave}
          submitting={submitting}
          submitError={submitError}
          onCancel={closeSheet}
        />
      </Tearsheet>
    </ChartContainer>
  );
}

/** Read whoop_error[...] params that /api/callback may have appended to the URL. */
function readOAuthError(): OAuthError | null {
  const params = new URLSearchParams(window.location.search);
  const error = params.get('whoop_error');
  if (!error) {
    return null;
  }
  return {
    error,
    description: params.get('whoop_error_description') ?? undefined,
    hint: params.get('whoop_error_hint') ?? undefined,
  };
}

/** Strip the whoop_error[...] params so a refresh doesn't re-show the banner. */
function clearOAuthErrorParams(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('whoop_error');
  url.searchParams.delete('whoop_error_description');
  url.searchParams.delete('whoop_error_hint');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function App() {
  const [state, setState] = useState<ConnectionState>('loading');
  const [session, setSession] = useState<SessionStatus | null>(null);
  // True when the waking-retry budget ran out without ever reaching the
  // server/database — used to explain the disconnected screen honestly.
  const [unreachable, setUnreachable] = useState(false);
  // Read any provider error straight from the URL on first render (no effect
  // setState). The effect below only strips the params from the address bar.
  const [oauthError, setOAuthError] = useState<OAuthError | null>(readOAuthError);
  // Manual "Sync now" (see handleSyncNow). Kept in App because the button sits
  // in the header, next to the connection chip it depends on.
  const [syncState, setSyncState] = useState<ManualSyncState>('idle');
  // Selected dashboard window (4.14), restored from localStorage during the
  // first render rather than in an effect — an effect would flash the 30-day
  // view and fire a second, immediately-superseded fetch for anyone on 90.
  const [rangeDays, setRangeDays] = useState<RangeDays>(readStoredRangeDays);
  // One fetch feeds both ring tiles (see RecoveryRingTile's comment). RING_DAYS
  // stays fixed at 7 — the toggle does not touch the rings (4.14 scope).
  const ringSeries = useDailySeries(RING_DAYS);
  // One range-driven fetch feeds RecoveryStrainTile, HrvBaselineTile,
  // SkinTempTile and both stat cards — same no-duplicate-fetch rule, different
  // window than the rings. useDailySeries keys its effect on `days`, so
  // flipping the toggle refetches; per that hook's comment the previous points
  // linger until the new response lands (no loading flash, no cleared tiles).
  const dailySeries = useDailySeries(rangeDays);

  /** Apply a new range and persist it. Single place the two stay in sync. */
  function handleRangeChange(next: RangeDays): void {
    setRangeDays(next);
    storeRangeDays(next);
  }

  /**
   * Pull fresh WHOOP data on demand. The Vercel Hobby cron can only run once a
   * day, and it runs before the previous night's cycle/sleep/recovery are
   * SCORED, so without this the newest day stays empty until the next run.
   *
   * MUST be a fetch with method POST — /api/sync-me rejects GET on purpose
   * (the session cookie is SameSite=Lax, so POST-only is what makes the
   * endpoint CSRF-safe). Do not convert this to a <Button href>.
   *
   * On success we reload rather than refetch: useDailySeries/useSleepStages
   * only fetch on mount, so a reload is the honest way to get every tile onto
   * the new rows without inventing a refetch channel.
   */
  async function handleSyncNow(): Promise<void> {
    setSyncState('syncing');
    try {
      const res = await fetch('/api/sync-me', { method: 'POST' });
      if (res.status === 429) {
        setSyncState('cooldown');
        return;
      }
      if (!res.ok) {
        setSyncState('error');
        return;
      }
      const body = (await res.json()) as { ok?: boolean; reauthRequired?: boolean };
      if (body.reauthRequired) {
        setSyncState('reauth');
        return;
      }
      window.location.reload();
    } catch {
      // Network failure or an unparseable body — surface it, never throw.
      setSyncState('error');
    }
  }

  // Clean the whoop_error[...] params so a refresh doesn't re-show the banner.
  useEffect(() => {
    if (readOAuthError()) {
      clearOAuthErrorParams();
    }
  }, []);

  // Ask the server whether this browser's session is valid. A `waking:true`
  // 503 (paused/waking Supabase project, Phase 2.5) or a timeout is retried
  // with capped backoff by checkSessionWithRetry — the UI sits in the 'waking'
  // state meanwhile. Genuine failures still degrade straight to disconnected.
  useEffect(() => {
    let cancelled = false;
    void checkSessionWithRetry({
      onWaking: () => {
        if (!cancelled) {
          setState('waking');
        }
      },
      isCancelled: () => cancelled,
    }).then((outcome) => {
      if (cancelled || outcome === null) {
        return;
      }
      if (outcome.kind === 'connected') {
        setSession(outcome.session);
        setState('connected');
        return;
      }
      // 'disconnected' (definitive), 'error' (genuine failure), and
      // 'unreachable' (retry budget exhausted) all land on the disconnected
      // screen; 'unreachable' additionally shows the resume-your-project hint.
      setUnreachable(outcome.kind === 'unreachable');
      setState('disconnected');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <header className="app-header">
        <h1 className="brand">WHOOP Dashboard</h1>
        <div className="header-session">
          <span className={`status-chip status-${state}`}>
            <span className="status-dot" aria-hidden="true" />
            {STATUS_LABELS[state]}
          </span>
          {/* Same real navigations the auth card uses (302 flows, not
              fetches), driven by the same single connection state. */}
          {state === 'connected' && (
            <>
              {/* A real fetch (POST), unlike the 302-navigation buttons beside
                  it — see handleSyncNow for why POST is load-bearing. */}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleSyncNow()}
                disabled={syncState === 'syncing'}
                aria-busy={syncState === 'syncing'}
              >
                {SYNC_LABELS[syncState]}
              </Button>
              <Button variant="secondary" size="sm" href="/api/logout">
                Disconnect
              </Button>
            </>
          )}
          {state === 'disconnected' && (
            <Button variant="secondary" size="sm" href="/api/auth">
              Connect WHOOP
            </Button>
          )}
        </div>
      </header>

      <main className="dashboard">
        {oauthError && (
          <div className="banner" role="alert">
            <div className="banner-text">
              <strong>Couldn’t connect to WHOOP.</strong>{' '}
              <span>{oauthError.description ?? oauthError.error}</span>
              {oauthError.hint && <span className="banner-hint"> {oauthError.hint}</span>}
            </div>
            <button
              type="button"
              className="banner-dismiss"
              aria-label="Dismiss error"
              onClick={() => setOAuthError(null)}
            >
              ✕
            </button>
          </div>
        )}

        <Card
          as="section"
          padding="lg"
          radius="xl"
          className="auth-card"
          aria-busy={state === 'loading' || state === 'waking'}
        >
          {/* Head row (2026-08-01): the heading on the left, the Connect
              action pinned top-right. The action's CONDITION is unchanged —
              it renders only while disconnected, never when WHOOP is already
              linked; only its position moved out of the body below. */}
          <div className="auth-card-head">
            <h2>Connection</h2>
            {state === 'disconnected' && (
              // Top-level redirect (302 flow), not a fetch — a real navigation.
              <Button variant="primary" size="sm" href="/api/auth">
                Connect WHOOP
              </Button>
            )}
          </div>

          {state === 'loading' && <LoadingState label="Checking your connection…" />}

          {state === 'waking' && (
            <LoadingState label="Waking up your database — free-tier projects doze off when idle. Retrying for up to 30 seconds…" />
          )}

          {state === 'disconnected' && (
            <>
              {unreachable && (
                <ErrorState message="We couldn’t reach your database. Free-tier Supabase projects pause after about a week of inactivity and have to be resumed from the Supabase dashboard — resume it there, then refresh this page." />
              )}
              {/* The Connect button used to sit HERE, under this line; it is
                  now in the head row above (2026-08-01). Same condition, same
                  href, same 302 flow — only the position changed. */}
              <p className="muted">Connect your WHOOP account to pull in your data.</p>
            </>
          )}

          {state === 'connected' && session && (
            <>
              <p className="status">
                <span className="dot" aria-hidden="true" />
                Connected to WHOOP
              </p>
              <dl className="meta">
                <dt>Member ID</dt>
                <dd>{session.userId}</dd>
                <dt>Scopes</dt>
                <dd>{session.scope ?? '—'}</dd>
              </dl>
              {/* Disconnect moved to the header (task 3.2) — one action, not two. */}
            </>
          )}
        </Card>

        {/* 4.14 time-range toggle. Placed in the 1200px MAIN COLUMN, as shell
            content beside the OAuth banner and auth card — deliberately NOT
            inside .bento-grid: design.md §2's confirmed Figma layout is a
            430px mobile frame with no reserved slot for a control, and the
            grid is capped at 640px, so forcing one in would mean editing the
            locked grid-template-areas. This placement is purely additive and
            reversible — nothing in the bento grid changed to accommodate it. */}
        <div className="range-toggle-row">
          <RangeToggle
            label="Dashboard time range"
            options={RANGE_OPTIONS}
            value={rangeDays}
            onChange={handleRangeChange}
          />
        </div>

        <section className="bento-grid" aria-label="Charts">
          <PeriodMeterTile />

          <JournalTile />

          <RecoveryRingTile series={ringSeries} />

          <SleepStatTile series={dailySeries} rangeDays={rangeDays} />

          <CaloriesStatTile series={dailySeries} rangeDays={rangeDays} />

          <StrainRingTile series={ringSeries} />

          <SkinTempTile series={dailySeries} rangeDays={rangeDays} />

          <HrvBaselineTile series={dailySeries} rangeDays={rangeDays} />

          <RhrBaselineTile series={dailySeries} rangeDays={rangeDays} />
        </section>

        <SleepStagesTile />
        <RecoveryStrainTile series={dailySeries} rangeDays={rangeDays} />
        <HydrationRecoveryTile series={dailySeries} rangeDays={rangeDays} />
      </main>
    </>
  );
}

export default App;
