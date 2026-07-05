// Frontend /api/session check with a "waking database" retry loop (Phase 2.5).
//
// WHY THIS EXISTS: Supabase pauses inactive free-tier projects (7 days of low
// activity — https://supabase.com/docs/guides/platform/free-project-pausing,
// verified 2026-07-05). When that happens, /api/session responds
// `503 { connected:false, waking:true }` (see api/session.ts). Without this
// loop the SPA would drop straight to the "Connect WHOOP" screen, which is a
// lie — the user IS connected; the database is just unavailable.
//
// IMPORTANT REALITY CHECK (from the same docs): a paused free-tier project
// does NOT auto-resume when a request arrives — the owner must click "Resume
// project" in the Supabase dashboard, which then takes a couple of minutes.
// So this retry loop is NOT what un-pauses the project. Its jobs are:
//   1. ride out TRANSIENT unavailability (gateway blips, a project mid-resume,
//      a briefly hung function) that heals within the ~30s retry budget;
//   2. keep the UI honest ("your database is unavailable") instead of showing
//      a misleading disconnected state while retries run;
//   3. degrade gracefully — a real outage exhausts the capped budget and falls
//      through to 'unreachable', never retrying forever.
//
// This module is deliberately framework-free and dependency-injectable
// (fetchFn/sleep/isCancelled) so scripts/test-backoff.mjs can drive it
// deterministically with no DOM, no timers, and no network.

/** Shape of /api/session's JSON. The server never returns token material —
 * only the connection status plus non-sensitive metadata. */
export interface SessionStatus {
  connected: boolean;
  waking?: boolean;
  userId?: string;
  scope?: string | null;
  expiresAt?: string | null;
}

export type SessionCheckOutcome =
  /** Server confirmed a live WHOOP link. */
  | { kind: 'connected'; session: SessionStatus }
  /** Server answered definitively: no valid session (200 connected:false). */
  | { kind: 'disconnected' }
  /** Server answered with a genuine, non-waking failure (e.g. 500) — not
   *  retried, surfaces immediately (same as pre-2.5 behavior). */
  | { kind: 'error' }
  /** Every attempt hit the waking/timeout path and the retry budget ran out.
   *  The UI shows the "resume your Supabase project" hint for this one. */
  | { kind: 'unreachable' };

// Retry schedule: capped exponential backoff, ~30s total wait (2+4+8+8+8).
// 30s comfortably covers transient gateway errors and function cold starts; a
// genuinely PAUSED project needs a manual dashboard resume measured in
// minutes, so retrying longer than this only delays honest feedback.
export const WAKING_RETRY_DELAYS_MS: readonly number[] = [2000, 4000, 8000, 8000, 8000];

// Per-attempt timeout. A function stuck waiting on an unreachable database can
// hang well past this; treat the timeout like a waking response and retry.
export const ATTEMPT_TIMEOUT_MS = 10_000;

export interface SessionCheckOptions {
  /** Injection point for tests; defaults to the real global fetch. */
  fetchFn?: typeof fetch;
  /** Injection point for tests; defaults to a real setTimeout sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Called each time an attempt failed retriably and a retry is scheduled —
   *  the App uses it to flip into the 'waking' UI state. */
  onWaking?: () => void;
  /** Return true to abandon the loop (component unmounted). The promise then
   *  resolves null and no further fetches are made. */
  isCancelled?: () => boolean;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when the response is the server's explicit "database waking" signal. */
function isWakingResponse(status: number, body: unknown): boolean {
  return (
    status === 503 &&
    typeof body === 'object' &&
    body !== null &&
    (body as { waking?: unknown }).waking === true
  );
}

/**
 * Check /api/session, retrying `waking:true` responses (and timeouts/network
 * errors) with the capped backoff above. Resolves with a definitive outcome,
 * or null if cancelled. Never throws and never retries a genuine failure.
 */
export async function checkSessionWithRetry(
  options: SessionCheckOptions = {},
): Promise<SessionCheckOutcome | null> {
  // Bind, because calling an extracted `fetch` without its global `this`
  // throws "Illegal invocation" in some browsers.
  const fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
  const sleep = options.sleep ?? defaultSleep;
  const cancelled = (): boolean => options.isCancelled?.() ?? false;

  for (let attempt = 0; ; attempt += 1) {
    let retriable: boolean;
    try {
      const res = await fetchFn('/api/session', {
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
      if (res.ok) {
        const data = (await res.json()) as SessionStatus;
        return data.connected ? { kind: 'connected', session: data } : { kind: 'disconnected' };
      }
      const body: unknown = await res.json().catch(() => null);
      retriable = isWakingResponse(res.status, body);
    } catch {
      // Timeout (AbortSignal) or network error. The server may be hung behind
      // an unreachable database, so treat it like a waking response — the
      // capped budget keeps a plain offline user from spinning forever.
      retriable = true;
    }
    if (cancelled()) {
      return null;
    }
    if (!retriable) {
      return { kind: 'error' };
    }
    if (attempt >= WAKING_RETRY_DELAYS_MS.length) {
      return { kind: 'unreachable' };
    }
    options.onWaking?.();
    await sleep(WAKING_RETRY_DELAYS_MS[attempt]);
    if (cancelled()) {
      return null;
    }
  }
}
