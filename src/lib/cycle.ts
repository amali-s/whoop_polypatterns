// Phase 4.10 — cycle-day computation for the period-meter tile.
//
// Pure date logic: zero imports, zero I/O — unit-tested by
// scripts/test-cycle.mjs the same way api/_lib/transforms.ts is tested by
// test-transforms.mjs. Built against the confirmed shape of the Phase 5 daily
// journal's "Period" field; since 5.7 that data really flows, through
// GET /api/journal?from=&to= → src/hooks/usePeriodLogs.ts → PeriodMeterTile.
// The window that read uses is finite, which is what `dropClippedEpisode`
// below exists to handle — this module still imports nothing and reads nothing.
//
// Cycle-start detection is INFERRED (design.md §4, CONFIRMED 2026-07-18): the
// journal logs "Period: yes" one day at a time and never asks "is this day 1?",
// so episodes are reconstructed from the gaps between explicit 'yes' days.

/**
 * One journal day's period answer. `date` is an ISO 'YYYY-MM-DD' local
 * calendar day. `null` means NOT LOGGED — the user didn't open the journal —
 * and is deliberately distinct from an explicit 'no' (ROADMAP 5.1's tri-state
 * requirement). Neither breaks an episode: only the gap between 'yes' days
 * matters, so an ordinary missed-logging day can never split one period in two.
 */
export type PeriodLog = { date: string; period: 'yes' | 'no' | null };

/**
 * A 'yes' day starts a NEW episode when the gap since the previous 'yes' day
 * exceeds this many calendar days. 3 tolerates a missed logging day or two
 * mid-period while staying far below any realistic cycle length. This is a
 * chosen heuristic (user-confirmed 2026-07-18), NOT a clinically derived
 * value.
 */
export const EPISODE_GAP_DAYS = 3;

/** One inferred period episode: its start (= cycle start) and its 'yes' days. */
export interface PeriodEpisode {
  startDate: string;
  days: string[];
}

/**
 * Drop the oldest episode when a hard window boundary could have BISECTED it.
 *
 * The 5.7 read path fetches a fixed window (100 days) rather than the whole
 * journal, so the log handed to `detectEpisodes` can begin part-way through a
 * real period. The first 'yes' day inside the window then looks like a cycle
 * start and is not one — the genuine start sits outside, unfetched. That one
 * fabricated start corrupts the FIRST start-to-start gap, and with only ~3
 * episodes in 100 days there are only 2 gaps, so a single bad one moves the
 * mean `estimateCycleLength` reports by days.
 *
 * WHEN A START CANNOT BE PROVEN GENUINE. The nearest day the window could be
 * hiding is `windowStart − 1`. That day joins this episode only if the gap to
 * it is within the grouping rule:
 *
 *     start − (windowStart − 1) <= EPISODE_GAP_DAYS
 *     ⇔ start − windowStart < EPISODE_GAP_DAYS
 *
 * So an offset of 0…EPISODE_GAP_DAYS−1 is UNPROVABLE (dropped) and an offset of
 * exactly EPISODE_GAP_DAYS is PROVABLY genuine (kept): a hidden 'yes' at
 * `windowStart − 1` would then be EPISODE_GAP_DAYS + 1 days away, which the
 * `> EPISODE_GAP_DAYS` rule in `detectEpisodes` already splits into its own
 * episode. Same "> not ≥" boundary as the grouping rule, derived from it rather
 * than chosen separately — `EPISODE_GAP_DAYS` itself is untouched.
 *
 * Costs at most one episode. When the dropped one was the ONLY episode the
 * caller is left with `no-data`, which is the honest outcome: an unprovable
 * start would have produced a `dayOfCycle` that is simply wrong, not merely
 * imprecise.
 */
export function dropClippedEpisode(
  episodes: PeriodEpisode[],
  windowStart: string,
): PeriodEpisode[] {
  const oldest = episodes[0];
  if (oldest === undefined) {
    return episodes;
  }
  const offset = dayNumber(oldest.startDate) - dayNumber(windowStart);
  return offset < EPISODE_GAP_DAYS ? episodes.slice(1) : episodes;
}

export type CycleState =
  /** Zero explicit 'yes' days ever — nothing can honestly be shown. */
  | { kind: 'no-data' }
  /** A start date exists but no cycle length does — day count only, no denominator. */
  | { kind: 'day-only'; dayOfCycle: number; startDate: string }
  | {
      kind: 'full';
      dayOfCycle: number;
      cycleLength: number;
      /**
       * The latest episode's start = cycle day 1, so a caller can map a
       * position in the meter back to the calendar day it stands for (which is
       * what lets the tile colour each dot by that day's logged answer). Same
       * ISO 'YYYY-MM-DD' as the logs it came from.
       */
      startDate: string;
      /** So the UI can label the denominator truthfully ("estimated" vs. what the user told us). */
      lengthSource: 'estimated' | 'user-reported';
    };

/**
 * 'YYYY-MM-DD' → integer day number (days since the Unix epoch). Built on
 * Date.UTC at noon-free midnight, NOT local-midnight parsing or raw
 * millisecond division: local Dates make a day spanning a DST transition
 * 23 or 25 hours long, so `(a - b) / 86400000` truncates off by one. UTC has
 * no DST, so every day is exactly 86_400_000 ms and the division is exact.
 */
function dayNumber(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

/**
 * Group explicit 'yes' days into period episodes. 'no' and null days are
 * ignored IDENTICALLY — neither is evidence of an episode boundary (only the
 * distance between 'yes' days is). Always recomputes from the full history it
 * is given, never appends incrementally: a retroactive journal edit can merge,
 * split, or shift episode boundaries, and only a full pass gets that right.
 *
 * `windowStart` is OPT-IN and describes the caller's data, not a filter: pass
 * the lower bound of the window `logs` was fetched over and a leading episode
 * the boundary may have bisected is discarded (`dropClippedEpisode`). Omit it
 * when `logs` is the complete history — nothing is clipped there, so nothing
 * should be dropped.
 */
export function detectEpisodes(logs: PeriodLog[], windowStart?: string): PeriodEpisode[] {
  const yesDays = logs
    .filter((log) => log.period === 'yes')
    .map((log) => log.date)
    .sort();

  const episodes: PeriodEpisode[] = [];
  let previous: string | null = null;
  for (const date of yesDays) {
    if (date === previous) {
      continue; // duplicate entries for one day are one day
    }
    if (previous === null || dayNumber(date) - dayNumber(previous) > EPISODE_GAP_DAYS) {
      episodes.push({ startDate: date, days: [date] });
    } else {
      episodes[episodes.length - 1].days.push(date);
    }
    previous = date;
  }
  return windowStart === undefined ? episodes : dropClippedEpisode(episodes, windowStart);
}

/**
 * Mean gap between consecutive episode START dates, rounded to whole days.
 * Fewer than 2 episodes → null: there is no gap to measure, and null is the
 * honest answer — callers must not substitute a default (never an assumed 28).
 */
export function estimateCycleLength(episodes: PeriodEpisode[]): number | null {
  if (episodes.length < 2) {
    return null;
  }
  let gapSum = 0;
  for (let i = 1; i < episodes.length; i++) {
    gapSum += dayNumber(episodes[i].startDate) - dayNumber(episodes[i - 1].startDate);
  }
  return Math.round(gapSum / (episodes.length - 1));
}

/**
 * What the period meter can honestly show today. `dayOfCycle` counts from the
 * most recent episode's start date INCLUSIVE (the start date itself is day 1)
 * and keeps counting past the end of bleeding — a cycle is longer than its
 * period — until the next episode begins. It may exceed `cycleLength` (a
 * longer-than-usual cycle); callers must surface that, not clamp it away.
 * Once ≥2 episodes exist the estimate is preferred over `typicalCycleLength`
 * (the once-asked Phase 5 value): measured history beats the remembered
 * answer, and `lengthSource` tells the UI which one it is looking at.
 *
 * `windowStart` is the OPTIONAL fourth argument, forwarded to
 * `detectEpisodes` — pass the lower bound of the window `logs` came from so a
 * boundary-bisected leading episode can't fake a cycle start (see
 * `dropClippedEpisode`). Omitting it keeps the pre-5.7 behaviour exactly.
 */
export function cycleState(
  logs: PeriodLog[],
  today: string,
  typicalCycleLength?: number | null,
  windowStart?: string,
): CycleState {
  const episodes = detectEpisodes(logs, windowStart);
  if (episodes.length === 0) {
    return { kind: 'no-data' };
  }
  const latest = episodes[episodes.length - 1];
  const dayOfCycle = dayNumber(today) - dayNumber(latest.startDate) + 1;

  const estimated = estimateCycleLength(episodes);
  if (estimated !== null) {
    return {
      kind: 'full',
      dayOfCycle,
      cycleLength: estimated,
      lengthSource: 'estimated',
      startDate: latest.startDate,
    };
  }
  if (typicalCycleLength != null && Number.isFinite(typicalCycleLength) && typicalCycleLength > 0) {
    return {
      kind: 'full',
      dayOfCycle,
      cycleLength: typicalCycleLength,
      lengthSource: 'user-reported',
      startDate: latest.startDate,
    };
  }
  return { kind: 'day-only', dayOfCycle, startDate: latest.startDate };
}
