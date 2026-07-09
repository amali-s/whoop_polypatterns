import { useEffect, useState } from 'react';
import './App.css';
import { checkSessionWithRetry, type SessionStatus } from './session-check';
import { Card } from './components/Card';
import { Button } from './components/Button';
import { ChartContainer } from './components/ChartContainer';
import { LoadingState, ErrorState } from './components/states';

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
          <ChartContainer className="bento-period" title="Cycle day —" bodyHeight={23}>
            <div
              className="period-bar"
              role="img"
              aria-label="Cycle progress placeholder — no data yet"
            >
              {Array.from({ length: 28 }, (_, i) => (
                <span key={i} className={i < 7 ? 'period-seg period-seg-active' : 'period-seg'} />
              ))}
            </div>
          </ChartContainer>

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

          <ChartContainer className="bento-recovery" title="Recovery">
            <div
              className="stat-donut stat-donut-recovery"
              role="img"
              aria-label="Recovery, no data yet"
            >
              <span className="stat-donut-value">—</span>
            </div>
          </ChartContainer>

          <ChartContainer className="bento-sleep" title="Sleep">
            <p className="stat-value">—:—hrs</p>
            <p className="stat-trend">No data yet</p>
          </ChartContainer>

          <ChartContainer className="bento-calories" title="Calories">
            <p className="stat-value">— cal</p>
            <p className="stat-trend">No data yet</p>
          </ChartContainer>

          <ChartContainer className="bento-strain" title="Strain">
            <div
              className="stat-donut stat-donut-strain"
              role="img"
              aria-label="Strain, no data yet"
            >
              <span className="stat-donut-value">—</span>
            </div>
          </ChartContainer>

          <ChartContainer className="bento-skintemp" title="Skin temp over time" bodyHeight={64}>
            <div
              className="sparkline-placeholder"
              role="img"
              aria-label="Skin temp trend, no data yet"
            />
          </ChartContainer>

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
      </main>
    </>
  );
}

export default App;
