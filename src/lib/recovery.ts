// WHOOP recovery zones — the ONE place the red/yellow/green cutoffs live.
//
// EXTRACTED from `src/App.tsx` in Phase 5.5 (they shipped there in 4.9), because a
// second consumer appeared: `AlcoholRecoveryDotMatrix` colors and ROWS its dots by
// zone, and re-deriving "67 / 34" inside a chart component is exactly how two places
// on one dashboard end up disagreeing about what "green" means. Nothing about the
// values, their hues, or the lookup changed in the move — `RecoveryRingTile` calls the
// same `recoveryZone()` it always did, now imported.
//
// Pure module: zero imports, zero I/O — the `src/lib/cycle.ts` / `stats.ts` contract,
// and the reason it is safe for both `App.tsx` and a chart component to depend on it
// (a chart importing from `App.tsx` would be a circular import through the charts
// barrel).

/**
 * VERIFIED against the official developer docs,
 * https://developer.whoop.com/docs/whoop-101/ (fetched 2026-07-14):
 * "GREEN 67-100%", "YELLOW 34-66%", "RED 0-33%".
 *
 * Ordered HIGHEST-first: `recoveryZone` takes the first zone whose `min` the score
 * clears, so the order is load-bearing, not cosmetic.
 *
 * Hues are the §1 fill-safe UI tokens, NOT the locked chart palette (design.md §1's
 * chart-6 lime is the generic "recovery" hue, but the donut's zone semantics predate
 * and override it). They may fill a shape and never color text — `--color-warning` is
 * 2.03:1 and `--color-positive` 3.10:1 on the card (design.md §5.1).
 */
export const RECOVERY_ZONES = [
  { min: 67, name: 'green', color: 'var(--color-positive)' },
  { min: 34, name: 'yellow', color: 'var(--color-warning)' },
  { min: 0, name: 'red', color: 'var(--color-negative)' },
] as const;

/** One entry of RECOVERY_ZONES. */
export type RecoveryZone = (typeof RECOVERY_ZONES)[number];

/** The zone a 0–100 recovery score falls in. */
export function recoveryZone(score: number): RecoveryZone {
  // score < 0 can't happen per the API contract, but the fallback keeps the
  // return type non-nullable without a non-null assertion.
  return RECOVERY_ZONES.find((zone) => score >= zone.min) ?? RECOVERY_ZONES[2];
}
