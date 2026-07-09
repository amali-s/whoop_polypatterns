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
 * swatch is `aria-hidden` and always carries a `--color-muted` border so it
 * clears the 3:1 non-text boundary regardless of which LOCKED hue it shows
 * (design.md §5.2 rule 4). Interactive toggles (4.7) render as real
 * `<button aria-pressed>` instead of a plain `<span>`.
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
              className="legend-swatch"
              aria-hidden="true"
              style={{ background: entry.color }}
            />
            {entry.label}
          </button>
        ) : (
          <span key={entry.key} className="legend-item">
            <span
              className="legend-swatch"
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
