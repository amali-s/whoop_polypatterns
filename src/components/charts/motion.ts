import type { CSSProperties } from 'react';

/**
 * Reduced-motion gate for D3 transitions (design.md §5.2 rule 5). Mirrors the
 * CSS `@media (prefers-reduced-motion: reduce)` rule already in
 * components.css. Call once per transition/entrance and use the returned
 * duration — 0 renders the final state immediately with no animated step.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Returns `fallback` ms normally, or 0 when the user has reduced motion on. */
export function chartTransitionDuration(fallback: number): number {
  return prefersReducedMotion() ? 0 : fallback;
}

/**
 * The shared hover/focus + tooltip enter/leave duration (2026-08-01). One
 * number for the CSS side (`.chart-mark` / `.chart-tooltip` in charts.css) and
 * the JS side (useTooltip's unmount delay) so the mark's ease-in retreat and
 * the tooltip's ease-in exit can't drift apart. Matches the 160ms the
 * tooltip's reveal has used since it was added.
 */
export const CHART_HOVER_DURATION = 160;

/**
 * Entrance style for a focusable `.chart-mark`.
 *
 * The marks used to carry `transition: opacity <duration>ms ease-out` INLINE,
 * which (being an inline declaration) beat any `transition` charts.css could
 * set on `.chart-mark` — so the hover/focus transition added 2026-08-01 could
 * never have applied. The duration now rides across as a custom property and
 * charts.css owns the whole `transition` shorthand: entrance opacity AND the
 * hover state, in one place rather than five.
 */
export function chartMarkStyle(entered: boolean, duration: number): CSSProperties {
  return {
    opacity: entered ? 1 : 0,
    '--chart-fade-duration': `${duration}ms`,
  } as CSSProperties;
}
