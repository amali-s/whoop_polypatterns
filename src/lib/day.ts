// Local calendar-day helpers, shared by everything that has to name "today"
// the way the USER experiences it (Phase 5.7).
//
// `localTodayISO` lived in src/App.tsx from 4.10 through 5.4. It moved here
// when usePeriodLogs needed the same day — one definition, imported twice,
// rather than a second copy that could drift by a timezone. App.tsx imports it
// from here now; nothing about what it returns changed.
//
// LOCAL vs. UTC, deliberately mixed and not an oversight:
//   * `localTodayISO` reads the LOCAL wall-clock date, because the journal's
//     `day` key is the day the user is living in — `new Date().toISOString()`
//     would file a 9pm entry in Los Angeles under tomorrow.
//   * `shiftDayISO` then does its arithmetic in UTC, because a local-midnight
//     Date makes a day spanning a DST transition 23 or 25 hours long and the
//     shift silently lands on the wrong date. Same reasoning (and the same
//     86_400_000 exactness) as `dayNumber` in src/lib/cycle.ts.
//
// Pure: no I/O beyond reading the clock, no imports.

/** Today as a local 'YYYY-MM-DD' — the calendar day the user is living in. */
export function localTodayISO(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * An ISO 'YYYY-MM-DD' shifted by `days` calendar days (negative shifts back).
 * The result is a calendar date, not an instant: no time component survives,
 * and the UTC arithmetic makes the count exact across DST transitions.
 */
export function shiftDayISO(day: string, days: number): string {
  const shifted = new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Inclusive calendar-day span between two ISO 'YYYY-MM-DD' days — the day COUNT
 * the /api/daily-series `?days=` param wants (Phase 4.16). `start === end` is 1,
 * "Aug 8 to Aug 17" is 10. Same UTC exactness as `shiftDayISO`: subtracting two
 * UTC-midnight instants makes every day exactly 86_400_000 ms, so no DST
 * transition can push the count off by one.
 */
export function dayCountInclusive(startDay: string, endDay: string): number {
  const start = Date.parse(`${startDay}T00:00:00Z`);
  const end = Date.parse(`${endDay}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}
