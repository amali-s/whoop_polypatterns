import { useEffect, useState } from 'react';
import './App.css';
import { checkSessionWithRetry, type SessionStatus } from './session-check';
import { Card } from './components/Card';
import { Button } from './components/Button';
import { ChartContainer, type ChartStatus } from './components/ChartContainer';
import { LoadingState, ErrorState } from './components/states';
import {
  DotMatrix,
  ProgressRing,
  RecoveryStrainComboChart,
  Sparkline,
  StackedBarChart,
  type StackedBarSeriesKey,
} from './components/charts';
import { cycleState, type PeriodLog } from './lib/cycle';
import { useSleepStages } from './hooks/useSleepStages';
import { useDailySeries, type DailySeriesState } from './hooks/useDailySeries';
import type { DailyMetricPoint, SleepStageBreakdownPoint } from '../api/_lib/transforms';
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

// Bento tile set — matches the confirmed Figma layout (file
// BWF8m6iu8eQJqJghVUbsOQ, node 86:71) tile for tile: period meter, journal,
// 4 stat/donut tiles, skin-temp sparkline, and the two HRV/RHR combo charts.
// Task 3.3: each tile now renders on Card + ChartContainer; the tile content
// is still static placeholder markup passed as ready-state children — real
// data + real chart rendering is Phase 4, which swaps the children for a D3
// chart and drives ChartContainer's status from fetch state. Daily journal
// has no data source yet (questionnaire is Phase 5) and is explicitly a stub.

// Chart 4.1 — sleep-stage segment order (bottom-to-top: deepest at the bottom,
// awake on top) and hue assignment. The mapping is a PROPOSAL documented in
// design.md §4 ("Sleep-stage color mapping"), pending confirmation; the hues
// themselves are the LOCKED §1 palette, used verbatim via their tokens.
const SLEEP_STAGE_KEYS: StackedBarSeriesKey<SleepStageBreakdownPoint>[] = [
  { key: 'deepMinutes', label: 'Deep', color: 'var(--color-chart-5)' },
  { key: 'remMinutes', label: 'REM', color: 'var(--color-chart-2)' },
  { key: 'lightMinutes', label: 'Light', color: 'var(--color-chart-1)' },
  { key: 'awakeMinutes', label: 'Awake', color: 'var(--color-chart-4)' },
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

const RECOVERY_STRAIN_DAYS = 30;

/**
 * Full-width combo-chart row below the bento grid (same "Layout gap" decision
 * as SleepStagesTile — chart 4.2 has no bento slot). Drives ChartContainer's
 * status from the fetch state. Receives the shared 30-day series from App
 * (4.11 lifted the fetch — SkinTempTile reads the same rows, and a per-tile
 * hook here would double-fetch them, the 4.9 rule).
 */
function RecoveryStrainTile({ series }: { series: DailySeriesState }) {
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
      subtitle={`Recovery % (line, left axis) over day strain (area, right axis) — last ${RECOVERY_STRAIN_DAYS} days`}
      status={status}
      loadingLabel="Loading your recovery and strain…"
      emptyMessage={
        series.status === 'unauthenticated'
          ? 'Connect your WHOOP account to see your recovery and strain.'
          : `No recovery or strain data in the last ${RECOVERY_STRAIN_DAYS} days — run a sync, then refresh.`
      }
      errorMessage="Couldn’t load recovery and strain. Refresh to try again."
    >
      <RecoveryStrainComboChart
        data={points}
        title="Recovery vs. strain"
        tableCaption={`Daily recovery percent and day strain, last ${RECOVERY_STRAIN_DAYS} days`}
      />
    </ChartContainer>
  );
}

// --- Phase 4.11 — skin-temp sparkline tile ---------------------------------

/**
 * Bento skin-temp tile (§4: `skin_temp_celsius`, chart-3 sparkline). Shares
 * App's single 30-day fetch with RecoveryStrainTile (the 4.9 rule against
 * per-tile duplicate fetches of identical rows).
 *
 * Status mapping deliberately DIVERGES from RecoveryStrainTile's: ready with
 * all-null skin temps is NOT mapped to 'empty' — null is the NORMAL case on
 * pre-4.0 hardware (the strap has no temp sensor), and 'empty' would read as
 * a broken connection. It falls through to the Sparkline's own noData state,
 * whose caption names the likely reason. Per the 4.9 rule, 'empty' means
 * 401/no session only. (buildDailySeries emits a point for every day in the
 * window, so `points.length === 0` never means "no data" either.)
 */
function SkinTempTile({ series }: { series: DailySeriesState }) {
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
        tableCaption={`Daily skin temperature in °C, last ${RECOVERY_STRAIN_DAYS} days`}
        noDataCaption={`no readings in the last ${RECOVERY_STRAIN_DAYS} days — skin temp needs WHOOP 4.0 or newer`}
      />
    </ChartContainer>
  );
}

// --- Phase 4.9 — recovery/strain progress-ring tiles -----------------------

/**
 * Window for the ring tiles' shared fetch. The rings show a single "latest
 * scored day", so a week is plenty of lookback (an unscored/in-progress
 * cycle means today is null and yesterday carries the value).
 */
const RING_DAYS = 7;

/**
 * WHOOP recovery zones — VERIFIED against the official developer docs,
 * https://developer.whoop.com/docs/whoop-101/ (fetched 2026-07-14):
 * "GREEN 67-100%", "YELLOW 34-66%", "RED 0-33%". Zone hues are the §1
 * fill-safe UI tokens; they color the ring arc only, never text (§5.1 —
 * --color-warning is 2.03:1 and --color-positive 3.10:1 on the card).
 */
const RECOVERY_ZONES = [
  { min: 67, name: 'green', color: 'var(--color-positive)' },
  { min: 34, name: 'yellow', color: 'var(--color-warning)' },
  { min: 0, name: 'red', color: 'var(--color-negative)' },
] as const;

/** Strain's scale ceiling — 0–21 Borg scale, same whoop-101 doc as above. */
const STRAIN_SCALE_MAX = 21;

function recoveryZone(score: number) {
  // score < 0 can't happen per the API contract, but the fallback keeps the
  // return type non-nullable without a non-null assertion.
  return RECOVERY_ZONES.find((zone) => score >= zone.min) ?? RECOVERY_ZONES[2];
}

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
 * rule drives App's second, 30-day fetch, shared by RecoveryStrainTile and
 * SkinTempTile (4.11); RING_DAYS stays a separate 7-day window because the
 * rings genuinely need less lookback.
 */
function RecoveryRingTile({ series }: { series: DailySeriesState }) {
  const latest =
    series.status === 'ready' ? latestScored(series.points, (p) => p.recoveryScore) : null;
  const zone = latest ? recoveryZone(latest.value) : null;
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
    </ChartContainer>
  );
}

/** Bento strain tile (§4: `strain` on WHOOP's 0–21 scale, chart-5 dark blue). */
function StrainRingTile({ series }: { series: DailySeriesState }) {
  const latest = series.status === 'ready' ? latestScored(series.points, (p) => p.strain) : null;
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
  // One fetch feeds both ring tiles (see RecoveryRingTile's comment).
  const ringSeries = useDailySeries(RING_DAYS);
  // One 30-day fetch feeds RecoveryStrainTile AND SkinTempTile — same
  // no-duplicate-fetch rule, different window than the rings.
  const dailySeries = useDailySeries(RECOVERY_STRAIN_DAYS);

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
            <Button variant="secondary" size="sm" href="/api/logout">
              Disconnect
            </Button>
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
          <h2>Connection</h2>

          {state === 'loading' && <LoadingState label="Checking your connection…" />}

          {state === 'waking' && (
            <LoadingState label="Waking up your database — free-tier projects doze off when idle. Retrying for up to 30 seconds…" />
          )}

          {state === 'disconnected' && (
            <>
              {unreachable && (
                <ErrorState message="We couldn’t reach your database. Free-tier Supabase projects pause after about a week of inactivity and have to be resumed from the Supabase dashboard — resume it there, then refresh this page." />
              )}
              <p className="muted">Connect your WHOOP account to pull in your data.</p>
              {/* Top-level redirect (302 flow), not a fetch — use a real navigation. */}
              <Button variant="primary" href="/api/auth">
                Connect WHOOP
              </Button>
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

        <section className="bento-grid" aria-label="Charts">
          <PeriodMeterTile />

          <ChartContainer
            className="bento-journal"
            title="Daily journal"
            subtitle={<span className="journal-stub">Stub — Phase 5, not yet built</span>}
          >
            <ul className="journal-stub-list" aria-hidden="true">
              <li>Hydrated</li>
              <li>Cramps</li>
              <li>Period</li>
              <li>Discharge</li>
              <li>Afternoon snack</li>
              <li>Traveled</li>
              <li>Caffeine</li>
              <li>Alcohol</li>
            </ul>
            <p className="journal-stub-note">
              No data source yet — the Phase 5 questionnaire hasn't been built.
            </p>
          </ChartContainer>

          <RecoveryRingTile series={ringSeries} />

          <ChartContainer className="bento-sleep" title="Sleep">
            <p className="stat-value">—:—hrs</p>
            <p className="stat-trend">No data yet</p>
          </ChartContainer>

          <ChartContainer className="bento-calories" title="Calories">
            <p className="stat-value">— cal</p>
            <p className="stat-trend">No data yet</p>
          </ChartContainer>

          <StrainRingTile series={ringSeries} />

          <SkinTempTile series={dailySeries} />

          <ChartContainer
            className="bento-hrv"
            title="HRV over time"
            bodyHeight={128}
            legend={
              <>
                <span className="legend-item">
                  <span className="legend-swatch legend-swatch-actual" aria-hidden="true" />
                  Actual HRV
                </span>
                <span className="legend-item">
                  <span className="legend-swatch legend-swatch-ideal" aria-hidden="true" />
                  Ideal HRV
                </span>
              </>
            }
          >
            <div
              className="combo-chart-placeholder"
              role="img"
              aria-label="HRV over time, no data yet"
            />
          </ChartContainer>

          <ChartContainer
            className="bento-rhr"
            title="RHR over time"
            bodyHeight={128}
            legend={
              <>
                <span className="legend-item">
                  <span className="legend-swatch legend-swatch-actual" aria-hidden="true" />
                  Actual RHR
                </span>
                <span className="legend-item">
                  <span className="legend-swatch legend-swatch-ideal" aria-hidden="true" />
                  Ideal RHR
                </span>
              </>
            }
          >
            <div
              className="combo-chart-placeholder"
              role="img"
              aria-label="RHR over time, no data yet"
            />
          </ChartContainer>
        </section>

        <SleepStagesTile />
        <RecoveryStrainTile series={dailySeries} />
      </main>
    </>
  );
}

export default App;
