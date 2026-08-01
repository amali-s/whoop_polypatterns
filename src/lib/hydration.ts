// Hydration display vocabulary (Phase 5.5) — the three colors and the three
// labels the hydration/recovery dot matrix and its legend both read.
//
// It lives here, not in the chart component, for the reason `react-refresh`
// enforces: a `.tsx` component file may export only components, so a constant
// two files share has to be a module of its own. That is also the existing
// convention — `src/lib/recovery.ts` holds the recovery zones and their hues
// for exactly the same reason (`src/App.tsx` and a chart both need them, and a
// chart importing from `App.tsx` would be a circular import through the charts
// barrel).
//
// Pure module: zero imports, zero I/O — the `cycle.ts` / `stats.ts` /
// `recovery.ts` contract.

/**
 * The three states of `daily_questionnaire.hydrated`, in legend order. This is
 * a DISPLAY vocabulary, not a data type: the stored value is
 * `boolean | null` (see `api/_lib/journal-types.ts`), and `undetermined` is the
 * NULL case — never answered — which 5.1 requires be distinguishable from an
 * answered `false` forever.
 */
export type HydrationState = 'hydrated' | 'dehydrated' | 'undetermined';

/**
 * Hue per state — the dot matrix's ONLY use of color, and its three legend
 * swatches. Checked against design.md §1 before choosing; all three are
 * existing tokens and no new color was introduced.
 *
 * - `hydrated` → `--color-chart-1`, light blue (water). §1's mapping table
 *   assigns chart-1 to "Sleep", which does not appear in this chart — the
 *   per-chart double-duty §1 already sanctions for chart-3 (skin temp vs. the
 *   period meter). 1.55:1 on the white card, so it depends on the muted
 *   hairline every dot and legend swatch carries (§5.2 rule 4).
 * - `dehydrated` → `--color-chart-2`, dark orange (dry/warm). §1 assigns
 *   chart-2 to "Calories", likewise absent here. Blue-vs-orange is also the
 *   standard colorblind-safe opposition, which matters more here than anywhere
 *   else on the dashboard because these two hues ARE the comparison.
 * - `undetermined` → `--color-border`, deliberately NOT a data hue. An
 *   unanswered day is an absence; a saturated color of its own would make
 *   "I didn't say" look like a third kind of answer.
 *
 * Deliberately NOT the recovery zone tokens: on this chart hue means hydration,
 * and reusing `--color-positive`/`-warning`/`-negative` would collide with the
 * recovery donut's locked zone semantics (design.md §1/§4).
 */
export const HYDRATION_COLORS: Record<HydrationState, string> = {
  hydrated: 'var(--color-chart-1)',
  dehydrated: 'var(--color-chart-2)',
  undetermined: 'var(--color-border)',
};

/**
 * Legend labels, in legend order. These name the COLOR CATEGORIES; the
 * per-day readouts (tooltip, aria-label, data table) deliberately stay closer
 * to the raw datum — "logged as not hydrated" / "No" rather than "dehydrated" —
 * because the journal asked a yes/no question about how the user felt, and a
 * checkbox answer isn't a clinical finding.
 */
export const HYDRATION_LABELS: Record<HydrationState, string> = {
  hydrated: 'Hydrated',
  dehydrated: 'Dehydrated',
  undetermined: 'Undetermined',
};

/** In legend / display order. */
export const HYDRATION_STATES: readonly HydrationState[] = [
  'hydrated',
  'dehydrated',
  'undetermined',
];

/** The state a stored answer falls in. `null` (never answered) → 'undetermined', never 'dehydrated'. */
export function hydrationState(hydrated: boolean | null): HydrationState {
  if (hydrated == null) {
    return 'undetermined';
  }
  return hydrated ? 'hydrated' : 'dehydrated';
}
