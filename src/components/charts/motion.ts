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
