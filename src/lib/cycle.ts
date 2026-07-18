// Phase 4.10 — cycle-day computation for the period-meter tile.
//
// Pure date logic: zero imports, zero I/O — unit-tested by
// scripts/test-cycle.mjs the same way api/_lib/transforms.ts is tested by
// test-transforms.mjs. The data source (the Phase 5 daily journal's "Period"
// field) does not exist yet; this module is built against its confirmed shape.
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

export type CycleState =
  /** Zero explicit 'yes' days ever — nothing can honestly be shown. */
  | { kind: 'no-data' }
  /** A start date exists but no cycle length does — day count only, no denominator. */
  | { kind: 'day-only'; dayOfCycle: number }
  | {
      kind: 'full';
      dayOfCycle: number;
      cycleLength: number;
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
 */
export function detectEpisodes(logs: PeriodLog[]): PeriodEpisode[] {
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
  return episodes;
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
 */
export function cycleState(
  logs: PeriodLog[],
  today: string,
  typicalCycleLength?: number | null,
): CycleState {
  const episodes = detectEpisodes(logs);
  if (episodes.length === 0) {
    return { kind: 'no-data' };
  }
  const latest = episodes[episodes.length - 1];
  const dayOfCycle = dayNumber(today) - dayNumber(latest.startDate) + 1;

  const estimated = estimateCycleLength(episodes);
  if (estimated !== null) {
    return { kind: 'full', dayOfCycle, cycleLength: estimated, lengthSource: 'estimated' };
  }
  if (typicalCycleLength != null && Number.isFinite(typicalCycleLength) && typicalCycleLength > 0) {
    return {
      kind: 'full',
      dayOfCycle,
      cycleLength: typicalCycleLength,
      lengthSource: 'user-reported',
    };
  }
  return { kind: 'day-only', dayOfCycle };
}
