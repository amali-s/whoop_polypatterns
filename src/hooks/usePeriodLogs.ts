import { useEffect, useState } from 'react';
import type { PeriodLog } from '../lib/cycle';
import { localTodayISO, shiftDayISO } from '../lib/day';

// Fetch state for GET /api/journal?from=&to= — the period history behind the
// cycle-day meter (Phase 5.7, closing the 4.10 seam). Follows useSleepStages
// EXACTLY: the same four-state discriminated union, a `cancelled` flag guarding
// every setState, and a non-OK or unparseable response degrading to a state the
// UI can render honestly — never a throw out of the effect.
//
// WHY A WINDOW AND NOT THE WHOLE JOURNAL: `cycleState` recomputes episodes from
// the full log it is given every time (retroactive edits must be able to merge
// and split boundaries), so this fetches history rather than a single day — but
// history the user will never see on a dot matrix is just payload. 100 days is
// ~3 episodes, enough for `estimateCycleLength` to have 2 gaps to average.
//
// The window's lower bound is returned alongside the logs BECAUSE it is
// load-bearing: a hard boundary can bisect a real period, so the tile passes it
// to `cycleState` as `windowStart` and the clipped leading episode is dropped
// (see `dropClippedEpisode` in src/lib/cycle.ts). A caller that fetched a
// window and then omitted its start would silently trust a fabricated cycle
// start, which is the whole failure this bound exists to prevent.

/** Days of period history fetched, ending today (inclusive of both ends). */
export const PERIOD_LOG_DAYS = 100;

export type PeriodLogsState =
  | { status: 'loading' }
  /** Server said 401 — no session. The tile shows this as an empty tile with a
   *  "connect WHOOP" note, not an error (nothing is broken). */
  | { status: 'unauthenticated' }
  | { status: 'error' }
  | {
      status: 'ready';
      /** Only days that HAVE a row; `[]` is a normal "nothing logged" answer. */
      logs: PeriodLog[];
      /** Lower bound of the fetched window — pass to `cycleState`. */
      windowStart: string;
      /** Upper bound (today, local) — the day the meter is counting to. */
      today: string;
    };

/** One element of the endpoint's `days` array. */
interface PeriodDayResponse {
  day?: unknown;
  period?: unknown;
}

/**
 * Endpoint rows → `PeriodLog[]`. Two things happen here and nothing else: the
 * `day` key is renamed to cycle.ts's `date`, and anything that is not a literal
 * 'yes'/'no' becomes `null` — the NOT-LOGGED value. That fallback direction is
 * the only safe one: `null` and 'no' are treated identically for grouping, so a
 * malformed value can never invent an episode, whereas defaulting to 'yes'
 * would. Rows without a usable `day` are dropped rather than given a made-up one.
 */
function toPeriodLogs(days: PeriodDayResponse[]): PeriodLog[] {
  const logs: PeriodLog[] = [];
  for (const entry of days) {
    if (typeof entry?.day !== 'string') {
      continue;
    }
    logs.push({
      date: entry.day,
      period: entry.period === 'yes' || entry.period === 'no' ? entry.period : null,
    });
  }
  return logs;
}

/** Load the last `days` days of period answers on mount. */
export function usePeriodLogs(days = PERIOD_LOG_DAYS): PeriodLogsState {
  const [state, setState] = useState<PeriodLogsState>({ status: 'loading' });

  // No synchronous "reset to loading" (react-hooks/set-state-in-effect), same
  // as useSleepStages: the initial state already is 'loading', and `days` is a
  // constant in practice.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Computed inside the effect so the window is the one that was actually
      // fetched — and so a tab left open across midnight doesn't have a
      // `today` from a previous render pinned into the ready state.
      const today = localTodayISO();
      const windowStart = shiftDayISO(today, -(days - 1));
      try {
        const res = await fetch(`/api/journal?from=${windowStart}&to=${today}`);
        if (res.status === 401) {
          if (!cancelled) {
            setState({ status: 'unauthenticated' });
          }
          return;
        }
        if (!res.ok) {
          // Includes the 503 waking case — a plain reload once the database is
          // back is fine for a dashboard tile; no retry loop needed here.
          if (!cancelled) {
            setState({ status: 'error' });
          }
          return;
        }
        const body = (await res.json()) as { days?: PeriodDayResponse[] };
        if (!cancelled) {
          setState(
            Array.isArray(body.days)
              ? { status: 'ready', logs: toPeriodLogs(body.days), windowStart, today }
              : { status: 'error' },
          );
        }
      } catch {
        // Network failure or an unparseable body (e.g. plain `vite dev`, which
        // has no /api at all).
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
