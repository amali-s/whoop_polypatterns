export interface LegendEntry {
  key: string;
  label: string;
  /** CSS color value (usually a --color-chart-N token via var()). */
  color: string;
  /** Interactive legends (4.7) pass a toggle handler; static legends omit it. */
  onToggle?: () => void;
  active?: boolean;
}

export interface LegendProps {
  entries: LegendEntry[];
}

/**
 * Shared legend row (4.0). Matches the swatch-+-real-text-label pattern
 * already locked in App.css/.legend-item/.legend-swatch (task 3.4): the
 * swatch is `aria-hidden`, the label beside it is real text (design.md §5.2
 * rule 6). Interactive toggles (4.7) render as real `<button aria-pressed>`
 * instead of a plain `<span>`.
 *
 * 2026-08-01: swatches rendered through this component carry
 * `.legend-swatch-plain` — the muted hairline is dropped for the redesigned
 * charts (sleep stages, recovery-vs-strain) at the user's direction. The
 * bordered default remains for legends built inline in App.tsx that still
 * need it; see the comment on `.legend-swatch-plain` in App.css.
 */
export function Legend({ entries }: LegendProps) {
  return (
    <>
      {entries.map((entry) =>
        entry.onToggle ? (
          <button
            key={entry.key}
            type="button"
            className="legend-item legend-item-toggle"
            aria-pressed={entry.active ?? true}
            onClick={entry.onToggle}
          >
            <span
              className="legend-swatch legend-swatch-plain"
              aria-hidden="true"
              style={{ background: entry.color }}
            />
            {entry.label}
          </button>
        ) : (
          <span key={entry.key} className="legend-item">
            <span
              className="legend-swatch legend-swatch-plain"
              aria-hidden="true"
              style={{ background: entry.color }}
            />
            {entry.label}
          </span>
        ),
      )}
    </>
  );
}
