import { useEffect, useState } from 'react';
import './App.css';

// Shape of /api/session's JSON. The server never returns token material — only
// the connection status plus non-sensitive metadata.
interface SessionStatus {
  connected: boolean;
  userId?: string;
  scope?: string | null;
  expiresAt?: string | null;
}

// A WHOOP provider error forwarded by /api/callback via query params.
interface OAuthError {
  error: string;
  description?: string;
  hint?: string;
}

type ConnectionState = 'loading' | 'connected' | 'disconnected';

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
  // Read any provider error straight from the URL on first render (no effect
  // setState). The effect below only strips the params from the address bar.
  const [oauthError, setOAuthError] = useState<OAuthError | null>(readOAuthError);

  // Clean the whoop_error[...] params so a refresh doesn't re-show the banner.
  useEffect(() => {
    if (readOAuthError()) {
      clearOAuthErrorParams();
    }
  }, []);

  // Ask the server whether this browser's session is valid. Any failure (network
  // error or non-200) degrades safely to the disconnected state.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/session')
      .then((res) => (res.ok ? (res.json() as Promise<SessionStatus>) : { connected: false }))
      .then((data) => {
        if (cancelled) {
          return;
        }
        setSession(data.connected ? data : null);
        setState(data.connected ? 'connected' : 'disconnected');
      })
      .catch(() => {
        if (!cancelled) {
          setState('disconnected');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main id="center">
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

      <section className="card" aria-busy={state === 'loading'}>
        <h1>WHOOP Dashboard</h1>

        {state === 'loading' && (
          <p className="muted" role="status">
            Checking your connection…
          </p>
        )}

        {state === 'disconnected' && (
          <>
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
            <a className="btn" href="/api/logout">
              Disconnect
            </a>
          </>
        )}
      </section>
    </main>
  );
}

export default App;
