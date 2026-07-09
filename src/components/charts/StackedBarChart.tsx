import { useEffect, useMemo, useState } from 'react';
import { stack } from 'd3-shape';
import { utcFormat } from 'd3-time-format';
import { scaleBand, scaleLinear } from './scales';
import { useChartDimensions } from './useChartDimensions';
import { ChartSvg } from './ChartSvg';
import { Axis } from './Axis';
import { Legend } from './Legend';
import { Tooltip } from './Tooltip';
import { useTooltip } from './useTooltip';
import { ChartDataTable } from './ChartDataTable';
import type { ChartDataColumn } from './ChartDataTable';
import { chartTransitionDuration } from './motion';

// Generic stacked-bar chart (4.1's component, but not sleep-specific — the
// same component can later render e.g. strain contributors per day). Follows
// the 4.0 split: D3 computes the stack layout + scales, React renders every
// element declaratively.
//
// NULL DISCIPLINE (transforms.ts header): a datum whose `total` accessor
// returns null renders as a VISIBLE GAP — no bar, never a zero-height stack.
// Its day still occupies a band slot on the x axis and its table row reads
// "no data", so a gap is a gap everywhere, including to screen readers.

/** Keys of T whose values are `number | null` — the only stackable fields. */
type NumericKeyOf<T> = {
  [K in keyof T]: T[K] extends number | null ? K : never;
}[keyof T] &
  string;

export interface StackedBarSeriesKey<T> {
  /** Field of T holding this segment's value (nullable number). */
  key: NumericKeyOf<T>;
  label: string;
  /** CSS color value (usually a --color-chart-N token via var()). */
  color: string;
}

export interface StackedBarChartProps<T> {
  /** One datum per band (e.g. per night), ascending. The data table renders from this same prop. */
  data: readonly T[];
  /** Segment order BOTTOM-TO-TOP. */
  keys: StackedBarSeriesKey<T>[];
  /** Day accessor (YYYY-MM-DD) — the band domain and row key. */
  day: (d: T) => string;
  /** Stack total. Null = unscored datum → rendered as a gap, never a zero bar. */
  total: (d: T) => number | null;
  /** Accessible chart name (design.md §5.2 rule 1). */
  title: string;
  /** Caption for the visually-hidden data table (rule 2). */
  tableCaption: string;
  /** Unit noun for the desc/tooltip/table, e.g. 'minutes'. */
  unit?: string;
}

const shortDay = utcFormat('%b %-d');
const longDay = utcFormat('%B %-d, %Y');

/** Format a YYYY-MM-DD day string via a UTC formatter (no local-zone day shift). */
function formatDay(day: string, formatter: (d: Date) => string): string {
  const date = new Date(day);
  return Number.isNaN(date.getTime()) ? day : formatter(date);
}

export function StackedBarChart<T>({
  data,
  keys,
  day,
  total,
  title,
  tableCaption,
  unit = 'minutes',
}: StackedBarChartProps<T>) {
  const [wrapperRef, dims] = useChartDimensions({ left: 44, bottom: 28 }, 0.32);
  const { tooltip, show, hide, onKeyDown } = useTooltip<T>();

  // Entrance animation, gated on reduced motion (design.md §5.2 rule 5): bars
  // fade in over `duration` ms; with reduced motion the duration is 0 and the
  // final state renders immediately.
  const duration = chartTransitionDuration(400);
  const [entered, setEntered] = useState(duration === 0);
  useEffect(() => {
    if (entered) {
      return;
    }
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [entered]);

  const days = useMemo(() => data.map(day), [data, day]);
  // Nights with a null total are excluded from the STACK ONLY — their day
  // stays in the band domain above, so the axis keeps a slot and the missing
  // bar reads as a gap.
  const barData = useMemo(() => data.filter((d) => total(d) != null), [data, total]);

  const xScale = useMemo(
    () => scaleBand<string>().domain(days).range([0, dims.boundedWidth]).padding(0.2),
    [days, dims.boundedWidth],
  );

  const yMax = useMemo(() => {
    const totals = barData.map(total).filter((v): v is number => v != null);
    return totals.length > 0 ? Math.max(...totals) : 1;
  }, [barData, total]);

  const yScale = useMemo(
    () => scaleLinear().domain([0, yMax]).range([dims.boundedHeight, 0]).nice(),
    [yMax, dims.boundedHeight],
  );

  const stackedSeries = useMemo(() => {
    const generator = stack<T>()
      .keys(keys.map((k) => k.key))
      .value((d, key) => (d[key as NumericKeyOf<T>] as number | null) ?? 0);
    return generator(barData);
  }, [barData, keys]);

  // Real title/desc describing the DATA, not the chart type (rule 1).
  const desc = useMemo(() => {
    if (data.length === 0) {
      return 'No data.';
    }
    const totals = data.map(total).filter((v): v is number => v != null);
    const first = formatDay(days[0], longDay);
    const last = formatDay(days[days.length - 1], longDay);
    const range =
      totals.length > 0
        ? `nightly totals range ${Math.min(...totals)} to ${Math.max(...totals)} ${unit}`
        : `no scored ${unit} totals`;
    const gaps = data.length - totals.length;
    const gapNote = gaps > 0 ? `; ${gaps} of ${data.length} nights have no data` : '';
    return `${keys.map((k) => k.label).join(', ')} per night from ${first} to ${last}; ${range}${gapNote}.`;
  }, [data, days, keys, total, unit]);

  // ~10 bottom ticks, evenly thinned — 30+ day labels would overlap.
  const tickValues = useMemo(() => {
    const step = Math.max(1, Math.ceil(days.length / 10));
    return days.filter((_, i) => i % step === 0);
  }, [days]);

  // Rule 2: the table renders from the SAME `data` prop the SVG draws — one
  // row per night, one column per stage, plus the total. Nulls read "no data".
  const tableColumns = useMemo<ChartDataColumn<T>[]>(
    () => [
      { key: 'day', header: 'Night', value: (row) => formatDay(day(row), longDay) },
      ...keys.map((k) => ({
        key: k.key,
        header: `${k.label} (${unit})`,
        value: (row: T) => row[k.key] as number | null,
      })),
      { key: 'total', header: `Total (${unit})`, value: (row) => total(row) },
    ],
    [keys, day, total, unit],
  );

  const tooltipDay = tooltip ? day(tooltip.datum) : null;

  return (
    <div className="chart-wrapper" ref={wrapperRef}>
      {dims.width > 0 && (
        <ChartSvg width={dims.width} height={dims.height} title={title} desc={desc}>
          <g transform={`translate(${dims.margin.left}, ${dims.margin.top})`}>
            <Axis scale={yScale} orientation="left" length={dims.boundedHeight} />
            <g transform={`translate(0, ${dims.boundedHeight})`}>
              <Axis
                scale={xScale}
                orientation="bottom"
                length={dims.boundedWidth}
                tickValues={tickValues}
                format={(value) => formatDay(String(value), shortDay)}
              />
            </g>
            {stackedSeries.map((layer, layerIndex) => {
              const meta = keys[layerIndex];
              return (
                <g key={meta.key}>
                  {layer.map((point) => {
                    const datum = point.data;
                    const bandX = xScale(day(datum));
                    const segmentValue = datum[meta.key] as number | null;
                    const y0 = yScale(point[0]);
                    const y1 = yScale(point[1]);
                    const height = y0 - y1;
                    if (bandX === undefined || !(height > 0)) {
                      // Zero/absent segments draw nothing (and take no Tab stop);
                      // their value still lives in the data table.
                      return null;
                    }
                    const datumTotal = total(datum);
                    const centerX = dims.margin.left + bandX + xScale.bandwidth() / 2;
                    const topY = dims.margin.top + yScale(datumTotal ?? point[1]);
                    return (
                      <rect
                        key={day(datum)}
                        className="chart-mark chart-bar-segment"
                        x={bandX}
                        y={y1}
                        width={xScale.bandwidth()}
                        height={height}
                        fill={meta.color}
                        style={{
                          opacity: entered ? 1 : 0,
                          transition: duration > 0 ? `opacity ${duration}ms ease-out` : undefined,
                        }}
                        tabIndex={0}
                        role="img"
                        aria-label={`${meta.label}, ${segmentValue ?? 0} ${unit} on ${formatDay(day(datum), longDay)}`}
                        onMouseEnter={() => show(datum, centerX, topY)}
                        onMouseLeave={hide}
                        onFocus={() => show(datum, centerX, topY)}
                        onBlur={hide}
                        onKeyDown={onKeyDown}
                      />
                    );
                  })}
                </g>
              );
            })}
          </g>
        </ChartSvg>
      )}
      {/* Identical content on hover and focus (rule 3) — one show() path. */}
      {tooltip && tooltipDay !== null && (
        <Tooltip x={tooltip.x} y={tooltip.y} visible>
          <strong>{formatDay(tooltipDay, longDay)}</strong>
          {/* Top-to-bottom to match the visual stack (keys are bottom-to-top). */}
          {[...keys].reverse().map((k) => {
            const value = tooltip.datum[k.key] as number | null;
            return (
              <div key={k.key}>
                {k.label}: {value ?? 'no data'} {unit}
              </div>
            );
          })}
          <div>
            Total: {total(tooltip.datum) ?? 'no data'} {unit}
          </div>
        </Tooltip>
      )}
      <ChartDataTable caption={tableCaption} rowKey={day} rows={data} columns={tableColumns} />
      {/* Rule 6: swatch + real text label per stage; Legend borders the swatch. */}
      <div className="ui-chart-legend">
        <Legend entries={keys.map((k) => ({ key: k.key, label: k.label, color: k.color }))} />
      </div>
    </div>
  );
}
