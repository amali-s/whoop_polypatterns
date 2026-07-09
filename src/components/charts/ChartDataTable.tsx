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
 */
export function ChartDataTable<T>({ caption, rowKey, rows, columns }: ChartDataTableProps<T>) {
  return (
    <table className="sr-only-table">
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
  );
}
