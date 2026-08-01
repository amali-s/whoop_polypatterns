export interface ChartDataColumn<T> {
  key: string;
  header: string;
  /** Return null/undefined to render "no data" — gaps must stay gaps (Phase 2 null discipline). */
  value: (row: T) => string | number | null | undefined;
}

export interface ChartDataTableProps<T> {
  caption: string;
  rowKey: (row: T) => string;
  rows: readonly T[];
  columns: ChartDataColumn<T>[];
}

/**
 * Visually-hidden (but screen-reader-exposed) data table (design.md §5.2
 * rule 2). Renders from the SAME transformed series the SVG draws — never a
 * re-fetch/re-derivation. Every chart's SVG can stay `aria-hidden` from the
 * row-by-row reading flow (the accessible name/desc on ChartSvg still
 * announces the chart) while this table carries the full values, including
 * gaps read as "no data" rather than 0.
 *
 * WRAPPER, added in the 2026-08-01 UI pass (task 1 — mobile layout lock): the
 * clipping styles used to sit on the `<table>` itself, and `overflow: hidden`
 * DOES NOT APPLY to `display: table` boxes — so the nowrap table laid out at
 * its full natural width and pushed the document's scrollWidth to 787px at a
 * 375px viewport (measured). That horizontal overflow is exactly what inflates
 * `window.innerWidth` past the layout viewport, which is the value a naive
 * JS breakpoint would read. The clip now lives on a `<div>` (a real block
 * container, where `overflow` is honoured); the `<table>` keeps its table
 * semantics untouched, so the §5.2 rule-2 contract is unchanged.
 */
export function ChartDataTable<T>({ caption, rowKey, rows, columns }: ChartDataTableProps<T>) {
  return (
    <div className="sr-only-table">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} scope="col">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((col) => {
                const value = col.value(row);
                return (
                  <td key={col.key}>{value === null || value === undefined ? 'no data' : value}</td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
