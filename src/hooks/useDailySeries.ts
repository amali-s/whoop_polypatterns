import { useEffect, useState } from 'react';
import type { DailyMetricPoint } from '../../api/_lib/transforms';

// Fetch state for GET /api/daily-series (chart 4.2). Type-only import above:
// transforms.ts is browser-safe by contract, but only the point TYPE is
// needed here — the shaping runs server-side and nothing from /api enters the
// bundle. Follows useSleepStages' discipline: a cancellation flag guards
// every setState, and a non-OK/unparseable response degrades to a state the
// UI can render honestly — never a throw out of the effect.

export type DailySeriesState =
  | { status: 'loading' }
  /** Server said 401 — no session. The dashboard shows this as an empty tile
   *  with a "connect WHOOP" note, not an error (nothing is broken). */
  | { status: 'unauthenticated' }
  | { status: 'error' }
  | { status: 'ready'; points: DailyMetricPoint[] };

/** Load the last `days` days of per-day metric points on mount. */
export function useDailySeries(days = 30): DailySeriesState {
  const [state, setState] = useState<DailySeriesState>({ status: 'loading' });

  // No synchronous "reset to loading" here (react-hooks/set-state-in-effect):
  // the initial state already is 'loading', and if `days` ever changes
  // mid-session the previous points simply linger until the new response
  // lands — acceptable for a dashboard tile, and it keeps the effect pure.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/daily-series?days=${days}`);
        if (res.status === 401) {
          if (!cancelled) {
            setState({ status: 'unauthenticated' });
          }
          return;
        }
        if (!res.ok) {
          // Includes the 503 waking case — a plain reload once the database
          // is back is fine for a chart tile; no retry loop needed here.
          if (!cancelled) {
            setState({ status: 'error' });
          }
          return;
        }
        const body = (await res.json()) as { points?: DailyMetricPoint[] };
        if (!cancelled) {
          setState(
            Array.isArray(body.points)
              ? { status: 'ready', points: body.points }
              : { status: 'error' },
          );
        }
      } catch {
        // Network failure or an unparseable body (e.g. plain `vite dev`,
        // which has no /api at all).
        if (!cancelled) {
          setState({ status: 'error' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [days]);

  return state;
}
