import { shiftDayISO } from './day';
import type { PeriodLog } from './cycle';

// What each dot in the cycle-day meter MEANS, and what colour says so
// (2026-08-03, at your direction). Before this, a dot's fill encoded only
// position — filled = elapsed, track = still to come. Now the elapsed dots
// carry the journal's own answer for that calendar day.
//
// Separate pure module rather than constants in App.tsx, exactly like
// src/lib/hydration.ts: `react-refresh/only-export-components` fails the build
// when a component file exports a constant, and a chart and its legend/caption
// must read one source or they can disagree about what a colour means.
//
// FOUR states, not two, because the journal's `period` column is a TRI-STATE
// and the row also contains days that haven't happened:
//
//   'yes'      the journal logged a period that day        → --color-chart-3
//   'no'       the journal logged NO period that day       → --color-chart-4
//   'unlogged' the journal was never filled in that day    → --color-border
//   'future'   a day the cycle hasn't reached yet          → --color-border
//
// 'unlogged' MUST NOT borrow the 'no' colour. That is the same null discipline
// the 0004 migration, journal-types.ts and cycle.ts all enforce: NULL means NOT
// ANSWERED, never "no". Painting an unlogged day as an answered one would put a
// claim on screen the user never made — so it takes the neutral track fill plus
// a DASHED outline, the "Undetermined" treatment HydrationRecoveryDotMatrix
// already uses for an unanswered day.
//
// CONTRAST / non-hue channels (§5.2 rule 4). #ffcce7 (1.2:1) and #d9e3f0
// (1.15:1) are both far under 3:1 on the white card, and --color-chart-4
// (#d9e3f0) is 10/255 in ONE channel away from --color-border (#cfe3f0) — as
// fills alone, a "no period" day and a day that hasn't happened are the same
// pixel. So reached 'no' / 'unlogged' dots wear the `--color-muted` hairline
// (the hydration-matrix precedent, which is what carries chart-1 and
// --color-border past 3:1 there), 'yes' is fill-only, and future dots wear
// none: the outline, not the fill, is what separates 'no' from future. The
// caption and <desc> then carry the counts as real text, so hue is never the
// only channel.

/** One dot's meaning. Ordered as the legend/caption reads them. */
export type PeriodDotState = 'yes' | 'no' | 'unlogged' | 'future';

/** Fill per state — fill-safe tokens only (§5.1). */
export const PERIOD_DOT_COLORS: Record<PeriodDotState, string> = {
  yes: 'var(--color-chart-3)',
  no: 'var(--color-chart-4)',
  unlogged: 'var(--color-border)',
  future: 'var(--color-border)',
};

/** Human wording for the counts in the caption / <desc>. */
export const PERIOD_DOT_LABELS: Record<PeriodDotState, string> = {
  yes: 'period',
  no: 'no period',
  unlogged: 'not logged',
  future: 'still to come',
};

/** How a dot is drawn, index-aligned to the row. */
export interface PeriodDotStyle {
  fill: string;
  /** Hairline outline — present on reached 'no' / 'unlogged' days (not 'yes'). */
  outlined: boolean;
  /** Dashed variant of that outline: "the journal wasn't filled in". */
  dashed: boolean;
}

/**
 * One dot per position in the meter, from `startDate` (cycle day 1) forward.
 *
 * `elapsed` is the number of leading dots the cycle has actually reached —
 * `dayOfCycle`, capped by the caller to the dots that exist. Everything past it
 * is 'future' and is NOT looked up: a day that hasn't happened has no answer to
 * show, and an absent row for it means nothing.
 *
 * Lookup is by exact ISO date, so a log array with gaps, duplicates or days
 * outside the cycle needs no pre-filtering — a date with no row is 'unlogged',
 * the same as a row whose `period` is null.
 */
export function periodDotStates(
  logs: readonly PeriodLog[],
  startDate: string,
  elapsed: number,
  total: number,
): PeriodDotState[] {
  const answers = new Map<string, PeriodLog['period']>();
  for (const log of logs) {
    // Last write wins on a duplicated date, matching detectEpisodes' "duplicate
    // entries for one day are one day".
    answers.set(log.date, log.period);
  }

  const states: PeriodDotState[] = [];
  for (let i = 0; i < total; i++) {
    if (i >= elapsed) {
      states.push('future');
      continue;
    }
    const answer = answers.get(shiftDayISO(startDate, i));
    states.push(answer === 'yes' ? 'yes' : answer === 'no' ? 'no' : 'unlogged');
  }
  return states;
}

/** States → the per-dot draw instructions DotMatrix takes. */
export function periodDotStyles(states: readonly PeriodDotState[]): PeriodDotStyle[] {
  return states.map((state) => ({
    fill: PERIOD_DOT_COLORS[state],
    // 'yes' is fill-only. Future dots stay bare; 'no' / 'unlogged' keep the
    // hairline so an answered "no period" still separates from a day that
    // hasn't happened (see the contrast note at the top).
    outlined: state === 'no' || state === 'unlogged',
    dashed: state === 'unlogged',
  }));
}

/** How many dots are in each state — for the caption and <desc> text. */
export function countDotStates(states: readonly PeriodDotState[]): Record<PeriodDotState, number> {
  const counts: Record<PeriodDotState, number> = { yes: 0, no: 0, unlogged: 0, future: 0 };
  for (const state of states) {
    counts[state] += 1;
  }
  return counts;
}

/**
 * The elapsed days as a sentence — the REAL-TEXT channel for what the colours
 * say (§5.2 rule 4), so the encoding survives with hue ignored entirely.
 * Mentions only states that occur, and returns '' when nothing has elapsed.
 */
export function describePeriodDots(states: readonly PeriodDotState[]): string {
  const counts = countDotStates(states);
  const parts = (['yes', 'no', 'unlogged'] as const)
    .filter((state) => counts[state] > 0)
    .map((state) => `${counts[state]} ${PERIOD_DOT_LABELS[state]}`);
  if (parts.length === 0) {
    return '';
  }
  const elapsed = counts.yes + counts.no + counts.unlogged;
  return `Of the ${elapsed} ${elapsed === 1 ? 'day' : 'days'} so far: ${parts.join(', ')}.`;
}
