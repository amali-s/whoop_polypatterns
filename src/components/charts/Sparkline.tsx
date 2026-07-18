import { useEffect, useMemo, useState } from 'react';
import { line } from 'd3-shape';
import { utcFormat } from 'd3-time-format';
import { scaleLinear, safeExtent } from './scales';
import { useChartDimensions } from './useChartDimensions';
import { ChartSvg } from './ChartSvg';
import { ChartDataTable } from './ChartDataTable';
import type { ChartDataColumn } from './ChartDataTable';
import { chartTransitionDuration } from './motion';
import type { DailyMetricPoint } from '../../../api/_lib/transforms';

// Sparkline (4.11): chrome-free skin-temp line for the bento `skintemp` tile —
// NO axes, NO gridlines, NO legend, NO tooltip, matching the Figma sparkline
// treatment (and the placeholder it replaces). Deliberately fixed to
// `skinTempCelsius` off DailyMetricPoint rather than generic over an accessor
// (the RecoveryStrainComboChart precedent: one metric, one known unit).
// Stroke/dot are --color-chart-3, the §1/§4 skin-temp token — which is ALSO
// the period-meter token; those two tiles do co-occur on this dashboard view,
// an ambiguity design.md §4 already accepts. Do not "fix" it with another hue.
//
// NULL DISCIPLINE (transforms.ts header): `.defined()` BREAKS the line at a
// null day — a gap is drawn as a gap, never interpolated across. Null skin
// temp is the NORMAL case on pre-4.0 hardware, so long runs of gaps (or a
// fully empty line) are expected, honest states here.
//
// design.md §5.2 compliance, scaled to the tile:
// - rule 1: renders through ChartSvg (role="img" + <title>/<desc> via
//   aria-labelledby); the <desc> describes the DATA — date span, value range,
//   reading count — derived from the same array the line draws from.
// - rule 2: ~30 values is a real series, NOT a single scalar, so the
//   ProgressRing/DotMatrix "the desc IS the fallback" shortcut does NOT
//   apply — a real ChartDataTable (day, skin temp °C) renders from the same
//   data prop, nulls reading "no data".
// - rule 3: n/a — a sparkline has no hover/tooltip surface, so there is no
//   keyboard-parity obligation. This omission is a decision, not an oversight.
// - rule 4: the latest reading is real visible text in --color-text (muted
//   when noData) — chart hues never color text (§5.1).
// - rule 5: the draw-on entrance is double-gated on prefers-reduced-motion:
//   chartTransitionDuration in JS (duration 0 skips the dash setup entirely)
//   AND the charts.css transition kill.

export interface SparklineProps {
  /** One point per calendar day, ascending (buildDailySeries output). The data table renders from this same prop. */
  data: readonly DailyMetricPoint[];
  /** Accessible chart name (design.md §5.2 rule 1). */
  title: string;
  /** Caption for the visually-hidden data table (rule 2). */
  tableCaption: string;
  /** Visible caption under the muted "—" in the noData state, naming the likely reason. */
  noDataCaption?: string;
}

const SPARK_COLOR = 'var(--color-chart-3)';

// Fixed plot height — the 64px the placeholder/bodyHeight occupied; the value
// line renders below it (the tile drops ChartContainer's bodyHeight prop, per
// that component's own guidance for Phase 4 charts).
const PLOT_HEIGHT = 64;

// Small explicit margins so the 2px stroke and the r=3 endpoint dot are not
// clipped at the viewBox edges — NOT DEFAULT_MARGIN, which reserves axis
// gutters this chart doesn't have.
const MARGIN = { top: 4, right: 6, bottom: 4, left: 6 };

const longDay = utcFormat('%B %-d, %Y');

/** Format a YYYY-MM-DD day string via a UTC formatter (no local-zone day shift). Mirrors RecoveryStrainComboChart's. */
function formatDay(day: string): string {
  const date = new Date(day);
  return Number.isNaN(date.getTime()) ? day : longDay(date);
}

/** Skin temp to one decimal — it varies by tenths of a °C; more is noise. */
function formatTemp(value: number): string {
  return value.toFixed(1);
}

export function Sparkline({ data, title, tableCaption, noDataCaption }: SparklineProps) {
  // The hook's aspect-ratio height fits the full-width charts, not a fixed
  // bento slot — use its responsive WIDTH only and pin the height to
  // PLOT_HEIGHT (the margins passed here still shape dims.boundedWidth).
  const [wrapperRef, dims] = useChartDimensions(MARGIN, 0.2);
  const boundedHeight = Math.max(0, PLOT_HEIGHT - MARGIN.top - MARGIN.bottom);

  // Entrance draw-on, gated on reduced motion (§5.2 rule 5) — same
  // entered-flag pattern as ProgressRing/DotMatrix.
  const duration = chartTransitionDuration(500);
  const [entered, setEntered] = useState(duration === 0);
  useEffect(() => {
    if (entered) {
      return;
    }
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [entered]);

  // X is index-based over the ordered day array — buildDailySeries emits one
  // point per calendar day with no missing days, so the points are evenly
  // spaced by construction and scaleTime reduces to `i / (n - 1)` across the
  // inner width (the DotMatrix/ProgressRing no-machinery precedent).
  const xAt = useMemo(() => {
    const n = data.length;
    return (i: number) => (n <= 1 ? dims.boundedWidth / 2 : (i / (n - 1)) * dims.boundedWidth);
  }, [data.length, dims.boundedWidth]);

  // Y domain is deliberately NOT zero-based: skin temp varies by well under
  // 1 °C, and a zero floor would flatten the line to nothing. Domain = data
  // extent plus a small symmetric pad (~5% of the span) so the min/max points
  // aren't welded to the plot edges. This makes the sparkline a
  // shape-of-trend, not a magnitude comparison.
  const yScale = useMemo(() => {
    const [lo, hi] = safeExtent(data, (d) => d.skinTempCelsius);
    const pad = (hi - lo) * 0.05;
    return scaleLinear()
      .domain([lo - pad, hi + pad])
      .range([boundedHeight, 0]);
  }, [data, boundedHeight]);

  // The `?? 0` fallback is unreachable — `.defined()` already excludes null
  // days — it only satisfies the type checker (combo-chart precedent).
  const linePath = useMemo(() => {
    const generator = line<DailyMetricPoint>()
      .defined((d) => d.skinTempCelsius != null)
      .x((_, i) => xAt(i))
      .y((d) => yScale(d.skinTempCelsius ?? 0));
    return generator(data) ?? '';
  }, [data, xAt, yScale]);

  // Latest non-null reading — marks the line's current end with a dot and
  // feeds the visible value text (rule 4). Plain scan, no useMemo — ≤30
  // items, and App's latestScored takes the same unmemoized approach.
  let latest: { index: number; value: number } | null = null;
  for (let i = data.length - 1; i >= 0; i--) {
    const value = data[i].skinTempCelsius;
    if (value != null) {
      latest = { index: i, value };
      break;
    }
  }

  const noData = latest === null;

  // Real desc describing the DATA (rule 1), honest when no day has a reading.
  const desc = useMemo(() => {
    if (data.length === 0) {
      return 'No data.';
    }
    const readings = data.map((d) => d.skinTempCelsius).filter((v): v is number => v != null);
    const first = formatDay(data[0].day);
    const last = formatDay(data[data.length - 1].day);
    if (readings.length === 0) {
      return `Skin temperature by day, ${first} to ${last}; no days have a reading.`;
    }
    const min = formatTemp(Math.min(...readings));
    const max = formatTemp(Math.max(...readings));
    return `Skin temperature by day, ${first} to ${last}, ranging ${min} to ${max} °C; ${readings.length} of ${data.length} days have a reading.`;
  }, [data]);

  // Rule 2: the table renders from the SAME `data` prop the line draws —
  // null accessor values reach ChartDataTable as null so IT renders "no data"
  // (never pre-formatted into strings here).
  const tableColumns = useMemo<ChartDataColumn<DailyMetricPoint>[]>(
    () => [
      { key: 'day', header: 'Day', value: (row) => formatDay(row.day) },
      {
        key: 'skinTemp',
        header: 'Skin temp °C',
        value: (row) => (row.skinTempCelsius == null ? null : formatTemp(row.skinTempCelsius)),
      },
    ],
    [],
  );

  return (
    <div className="sparkline">
      <div className="chart-wrapper" ref={wrapperRef}>
        {dims.width > 0 && (
          <ChartSvg width={dims.width} height={PLOT_HEIGHT} title={title} desc={desc}>
            {/* aria-hidden: the SVG's title/desc names the chart and the data
                table (rule 2) carries every value. In the noData state the
                path/dot simply don't render — an honestly empty plot area. */}
            <g aria-hidden="true" transform={`translate(${MARGIN.left}, ${MARGIN.top})`}>
              {linePath && (
                <path
                  className="sparkline-line"
                  d={linePath}
                  fill="none"
                  stroke={SPARK_COLOR}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  // Draw-on via normalized dash: pathLength=1 makes the whole
                  // (possibly multi-segment) path one dash unit, so no
                  // getTotalLength measuring. Skipped entirely under reduced
                  // motion (duration 0) — the final line renders immediately.
                  {...(duration > 0
                    ? {
                        pathLength: 1,
                        strokeDasharray: 1,
                        strokeDashoffset: entered ? 0 : 1,
                        style: { transition: `stroke-dashoffset ${duration}ms ease-out` },
                      }
                    : {})}
                />
              )}
              {latest && (
                <circle
                  className="sparkline-latest-dot"
                  cx={xAt(latest.index)}
                  cy={yScale(latest.value)}
                  r={3}
                  fill={SPARK_COLOR}
                  style={{
                    opacity: entered ? 1 : 0,
                    transition: duration > 0 ? `opacity ${duration}ms ease-out` : undefined,
                  }}
                />
              )}
            </g>
          </ChartSvg>
        )}
      </div>
      {/* Rule 4: the latest reading as real text in --color-text (muted "—"
          when noData) — never carried by the chart hue alone. */}
      <p className={noData ? 'sparkline-value sparkline-value-muted' : 'sparkline-value'}>
        {latest ? `${formatTemp(latest.value)}°C` : '—'}
      </p>
      {/* aria-hidden: the <desc> already says no day has a reading — this is
          the sighted-user copy (ProgressRing/DotMatrix caption precedent). */}
      {noData && noDataCaption && (
        <p className="sparkline-caption" aria-hidden="true">
          {noDataCaption}
        </p>
      )}
      {data.length > 0 && (
        <ChartDataTable
          caption={tableCaption}
          rowKey={(d) => d.day}
          rows={data}
          columns={tableColumns}
        />
      )}
    </div>
  );
}
