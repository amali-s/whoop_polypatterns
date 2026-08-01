import type { BaselineDelta } from '../../lib/stats';

// Trailing-average trend line (2026-08-01) — "▲ 12% above your 1-month
// average". Extracted from StatDelta rather than written fresh: the ▲/▼ glyph,
// its `.stat-delta-arrow` class, the aria-hidden treatment and the
// direction-from-the-ROUNDED-magnitude rule were already established by the
// 4.12 Sleep/Calories stat tiles, and the recovery/strain rings were asked for
// "the same triangle pattern the Sleep stat tile uses". `TrendArrow` below is
// now the ONE definition of that glyph; StatDelta imports it too.
//
// CORRECTION to the brief, flagged: there is no `Polygon`/triangle SVG asset or
// component in this codebase to reuse. The existing pattern is a literal ▲/▼
// text glyph inside StatDelta.tsx. Reusing it means sharing that glyph, which
// is what this file does — introducing an SVG triangle here would have created
// the second implementation the instruction was trying to avoid.
//
// design.md §5.2, mapped as in StatDelta (no SVG, no hover surface, so rules
// 1-3 and 5 are n/a): rule 4 is the live one. The comparison is a real text
// sentence; the triangle is decorative and aria-hidden, never the encoding.
// Deliberately NOT colored --color-positive/--color-negative — "strain above
// your 3-month average" is a description, not a verdict.

export interface TrendArrowProps {
  /** Rendered direction. `null` renders nothing (a rounds-to-zero delta). */
  direction: 'up' | 'down' | null;
}

/** The shared ▲/▼ glyph. Decorative — the sentence beside it carries the fact. */
export function TrendArrow({ direction }: TrendArrowProps) {
  if (direction === null) {
    return null;
  }
  return (
    <span className="stat-delta-arrow" aria-hidden="true">
      {direction === 'up' ? '▲' : '▼'}{' '}
    </span>
  );
}

export interface TrendIndicatorProps {
  /** The comparison to render (from baselineDelta in src/lib/stats.ts). */
  delta: BaselineDelta;
  /** Names the window being compared against, e.g. "1-month average". */
  windowLabel: string;
  /**
   * Shown instead of a comparison when the window holds too few scored days.
   * Defaults to naming the window so the user knows WHICH average is missing.
   */
  noBaselineText?: string;
}

/**
 * One trailing-average comparison as a percentage change. Percent (not the raw
 * unit) because recovery is already a percentage and strain is a unitless 0-21
 * score — "3.2 above your average" would be meaningless for one of them, while
 * "12% above" reads the same way for both.
 *
 * Renders NOTHING when today's value is absent: the ring above it already shows
 * a muted "—" and its own caption, and a dangling "no comparison" line under a
 * dash would just be noise.
 */
export function TrendIndicator({ delta, windowLabel, noBaselineText }: TrendIndicatorProps) {
  if (delta.kind === 'no-value') {
    return null;
  }

  if (delta.kind === 'no-baseline' || delta.percentDelta === null) {
    return (
      <p className="stat-delta-caption">
        {noBaselineText ?? `not enough history yet for a ${windowLabel}`}
      </p>
    );
  }

  // Direction comes from the ROUNDED percentage, not the raw delta, so a
  // sub-1% difference reads "in line with" rather than "0% above" (the
  // contradiction StatDelta's own comment warns about).
  const magnitude = Math.round(Math.abs(delta.percentDelta));
  const above = delta.percentDelta > 0;
  return (
    <p className="stat-delta-trend stat-delta-trend-compact">
      <TrendArrow direction={magnitude === 0 ? null : above ? 'up' : 'down'} />
      {magnitude === 0
        ? `In line with your ${windowLabel}`
        : `${magnitude}% ${above ? 'above' : 'below'} your ${windowLabel}`}
    </p>
  );
}
