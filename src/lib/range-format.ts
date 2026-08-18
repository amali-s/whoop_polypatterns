// Phase 4.16 — human copy for a calendar date span, shared by the custom
// date-range picker's trigger label and every range-driven tile's copy.
//
// One definition instead of the alternative the 4.16 brief warned against:
// duplicating "Aug 8 – Aug 17, 2026" formatting logic across the ~8 tiles that
// name their window. App.tsx wraps this with the RangeSelection-aware
// `rangeWindowLabel` helpers (preset → "last 30 days"; custom → this span);
// DateRangePicker.tsx uses it for the trigger's active-range label.
//
// UTC on purpose, the `formatRingDay` (App.tsx) / `shiftDayISO` (day.ts)
// precedent: an ISO 'YYYY-MM-DD' is parsed as UTC midnight and formatted with a
// UTC formatter, so no local-zone shift can move a calendar date onto the wrong
// day. A malformed string round-trips unchanged rather than throwing.

import { utcFormat } from 'd3-time-format';

const fullDate = utcFormat('%b %-d, %Y'); // "Aug 17, 2026"
const monthDay = utcFormat('%b %-d'); // "Aug 8"

/** Parse an ISO 'YYYY-MM-DD' as UTC midnight; null when it isn't a real date. */
function parseDay(day: string): Date | null {
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * A calendar span as display copy, both ends inclusive:
 *   - one day (start === end, the "Today" 1-day range)  → "Aug 17, 2026"
 *   - same calendar year                                 → "Aug 8 – Aug 17, 2026"
 *   - spanning a year boundary (a ≤90-day range can)     → "Dec 5, 2025 – Jan 3, 2026"
 *
 * The year is stated once (on the end) when both ends share it, and on both
 * ends when they differ, so the reader is never left guessing a year.
 */
export function formatDaySpan(startDay: string, endDay: string): string {
  const start = parseDay(startDay);
  const end = parseDay(endDay);
  if (!start || !end) {
    // Degrade to the raw strings rather than throw — a label is never worth a
    // crash (the readStoredRangeDays discipline).
    return startDay === endDay ? endDay : `${startDay} – ${endDay}`;
  }
  if (startDay === endDay) {
    return fullDate(end);
  }
  const startLabel =
    start.getUTCFullYear() === end.getUTCFullYear() ? monthDay(start) : fullDate(start);
  return `${startLabel} – ${fullDate(end)}`;
}
