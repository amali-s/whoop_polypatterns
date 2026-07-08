import { useEffect, useState } from 'react';
import './App.css';
import { checkSessionWithRetry, type SessionStatus } from './session-check';

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

// Six placeholder slots for the Phase 4 charts. Titles follow the SUGGESTED
// (unconfirmed) mappings in design.md §4; the real ChartContainer with
// loading/empty/error states is task 3.3, the charts themselves Phase 4.
const CHART_SLOTS: { title: string; kind: string }[] = [
  { title: 'Sleep stages', kind: 'Stacked bar' },
  { title: 'Recovery vs. strain', kind: 'Combo · line + area' },
  { title: 'HRV vs. baseline', kind: 'Combo · line + area' },
  { title: 'Recovery calendar', kind: 'Dot matrix' },
  { title: 'Sleep performance', kind: 'Dot matrix' },
  { title: 'Strain matrix', kind: 'Dot matrix' },
];

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
            <a className="btn-pill" href="/api/logout">
              Disconnect
            </a>
          )}
          {state === 'disconnected' && (
            <a className="btn-pill" href="/api/auth">
              Connect WHOOP
            </a>
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

        <section className="card" aria-busy={state === 'loading' || state === 'waking'}>
          <h2>Connection</h2>

          {state === 'loading' && (
            <p className="muted" role="status">
              Checking your connection…
            </p>
          )}

          {state === 'waking' && (
            <>
              <span className="spinner" aria-hidden="true" />
              <p className="muted" role="status">
                Waking up your database — free-tier projects doze off when idle. Retrying for up to
                30 seconds…
              </p>
            </>
          )}

          {state === 'disconnected' && (
            <>
              {unreachable && (
                <p className="muted" role="alert">
                  We couldn’t reach your database. Free-tier Supabase projects pause after about a
                  week of inactivity and have to be resumed from the Supabase dashboard — resume it
                  there, then refresh this page.
                </p>
              )}
              <p className="muted">Connect your WHOOP account to pull in your data.</p>
              {/* Top-level redirect (302 flow), not a fetch — use a real navigation. */}
              <a className="btn btn-primary" href="/api/auth">
                Connect WHOOP
              </a>
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
        </section>

        <section className="dashboard-grid" aria-label="Charts">
          {CHART_SLOTS.map((slot) => (
            <article className="chart-card" key={slot.title}>
              <h3>{slot.title}</h3>
              <p className="chart-card-kind">{slot.kind}</p>
              <div className="chart-card-placeholder">Chart coming soon</div>
            </article>
          ))}
        </section>
      </main>
    </>
  );
}

export default App;
