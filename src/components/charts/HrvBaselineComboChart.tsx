import { useEffect, useMemo, useState } from 'react';
import { area, line } from 'd3-shape';
import { utcFormat } from 'd3-time-format';
import { scaleBand, scaleLinear } from './scales';
import {
  useChartDimensions,
  CHART_PLOT_HEIGHT,
  WRAPPED_AXIS_BOTTOM_MARGIN,
} from './useChartDimensions';
import { ChartSvg } from './ChartSvg';
import { Axis } from './Axis';
import { Tooltip } from './Tooltip';
import { useTooltip } from './useTooltip';
import { ChartDataTable } from './ChartDataTable';
import type { ChartDataColumn } from './ChartDataTable';
import { chartTransitionDuration } from './motion';
import { buildRollingBaseline, type DailyMetricPoint } from '../../../api/_lib/transforms';

// Combo chart (4.3): daily HRV as a line OVER its own trailing rolling baseline
// as an area — ONE metric against its recent-normal, on ONE x (day) scale.
// Same fixed-pairing shape as RecoveryStrainComboChart (not generic over T):
// the metric (hrvRmssdMilli) and its unit (ms) are known to the component.
//
// SINGLE-SCALE CHOICE — the deliberate departure from 4.2. That chart plots two
// DIFFERENT metrics (recovery %, day strain) in two units, so it carries two
// independent y-axes. Here the line and the area are the SAME quantity (HRV in
// ms) — the actual value and a smoothed mean OF that value — so they MUST share
// one y-scale, or "above/below baseline" would be a lie.
//
// Y DOMAIN — FIXED 20-110 ms (confirmed 2026-08-01), replacing the previous
// data-driven [0, max].nice(). A fixed domain means a given HRV always sits at
// the same height, so the chart is comparable across range toggles and across
// weeks; the old zero-based domain rescaled itself and squashed the series into
// the top band. CONSEQUENCE, flagged: the scale is deliberately NOT clamped, so
// a day outside 20-110 draws outside the plotted band rather than being
// silently pinned to the edge — a visible overflow is more honest than a
// fabricated boundary value, and the data table carries the real number either
// way.
//
// BASELINE — computed CLIENT-SIDE from the same `data` prop via the pure,
// already-tested buildRollingBaseline (api/_lib/transforms). windowDays = 7 (a
// short "recent normal", deliberately NOT the 30-day BASELINE_WINDOW_DAYS the
// 4.12 stat-card deltas use), minSamples = its own default of 3 (this is a
// smoothed line, not a headline number, so no stricter floor than the original
// 3 rationale). The first days of the 30-day window legitimately show no
// baseline (below minSamples) — an expected gap, not a bug.
//
// MAPPING (decided 2026-07-21) — supersedes design.md §4's locked
// "population ideal-band" for chart 3, which is DEFERRED pending Phase 5
// cycle-day data. The band shown is a trailing rolling baseline, labelled
// "Recent baseline" (never "Ideal": there is no population study behind it).
//
// NULL DISCIPLINE (transforms.ts header): both generators use `.defined()` so a
// null day BREAKS the path into a visible gap — never drawn through 0, never
// interpolated across. The x (band) domain still holds every day, so the gap
// occupies real axis space.
//
// STROKES — all removed 2026-08-01 at the user's direction. Neither the actual
// line nor its focusable points carry the --color-muted casing/outline they
// used to, and the baseline's muted under-stroke is gone too. The hairlines
// existed to push the old pale-mustard baseline past §5.2 rule 4's 3:1 non-text
// threshold; with the tokens repointed (chart-7 → warm coral #FFA1A0, chart-4 →
// pale blue-grey #D9E3F0) the two series are separated by SHAPE — a line above
// a filled area — and every value is in the tooltip, the point's aria-label and
// the data table as real text, so hue is nowhere the sole encoding.

export interface HrvBaselineComboChartProps {
  /** One point per calendar day, ascending (buildDailySeries output). The baseline and data table both derive from this same prop. */
  data: readonly DailyMetricPoint[];
  /** Accessible chart name (design.md §5.2 rule 1). */
  title: string;
  /** Caption for the visually-hidden data table (rule 2). */
  tableCaption: string;
}

const HRV_COLOR = 'var(--color-chart-7)';
const BASELINE_COLOR = 'var(--color-chart-4)';

// Trailing window for the rolling baseline. Named distinctly from App's
// BASELINE_WINDOW_DAYS (the 30-day stat-card window) on purpose — this is a
// separate, shorter "recent normal", not the same constant.
const HRV_BASELINE_WINDOW_DAYS = 7;

// Fixed plot height, now the SHARED CHART_PLOT_HEIGHT (320px) rather than this
// chart's old 128px: sleep stages, recovery-vs-strain, HRV and RHR are all
// meant to read as the same size (confirmed 2026-08-01). Only the width is
// responsive (the Sparkline precedent).
const PLOT_HEIGHT = CHART_PLOT_HEIGHT;

// Axis gutters: left fits 2–3 digit ms labels; the bottom uses the shared
// deeper gutter because x labels may wrap to two lines; top/right keep the 2px
// strokes and r=3.5 points off the viewBox edges.
const MARGIN = { top: 8, right: 10, bottom: WRAPPED_AXIS_BOTTOM_MARGIN, left: 36 };

/**
 * Fixed y-axis extent in milliseconds (confirmed 2026-08-01). See the
 * Y DOMAIN note in the header for why it is fixed and why it is not clamped.
 */
const HRV_Y_DOMAIN: [number, number] = [20, 110];

const shortDay = utcFormat('%b %-d');
const longDay = utcFormat('%B %-d, %Y');

/** Format a YYYY-MM-DD day string via a UTC formatter (no local-zone day shift). Mirrors RecoveryStrainComboChart's. */
function formatDay(day: string, formatter: (d: Date) => string): string {
  const date = new Date(day);
  return Number.isNaN(date.getTime()) ? day : formatter(date);
}

/** HRV to whole milliseconds — the precision WHOOP itself surfaces; the tenths in the raw value are noise here. */
function formatHrv(value: number): string {
  return String(Math.round(value));
}

/** One day's actual HRV alongside its rolling-baseline mean — the row the SVG, tooltip, and table all read. */
interface HrvBaselineDatum {
  day: string;
  /** Actual daily HRV in ms (DailyMetricPoint.hrvRmssdMilli). */
  hrv: number | null;
  /** Trailing 7-day rolling-baseline mean in ms, or null below minSamples. */
  baseline: number | null;
}

export function HrvBaselineComboChart({ data, title, tableCaption }: HrvBaselineComboChartProps) {
  // Pass MARGIN + an (inert) aspect ratio for boundedWidth only; the height is
  // pinned to PLOT_HEIGHT, so dims.height is ignored (Sparkline precedent).
  const [wrapperRef, dims] = useChartDimensions(MARGIN, 0.3);
  const boundedHeight = Math.max(0, PLOT_HEIGHT - MARGIN.top - MARGIN.bottom);
  const { tooltip, show, hide, onKeyDown } = useTooltip<HrvBaselineDatum>();

  // Entrance fade, gated on reduced motion (design.md §5.2 rule 5) — same
  // fade-in pattern as RecoveryStrainComboChart.
  const duration = chartTransitionDuration(400);
  const [entered, setEntered] = useState(duration === 0);
  useEffect(() => {
    if (entered) {
      return;
    }
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [entered]);

  // Merge each day's actual HRV with its trailing rolling-baseline mean.
  // buildRollingBaseline preserves order and day, so index i lines up 1:1 with
  // `data`. Spread to a mutable array — the fn only reads, but its signature
  // asks for a non-readonly DailyMetricPoint[].
  const points = useMemo<HrvBaselineDatum[]>(() => {
    const baseline = buildRollingBaseline(
      [...data],
      (p) => p.hrvRmssdMilli,
      HRV_BASELINE_WINDOW_DAYS,
    );
    return data.map((d, i) => ({ day: d.day, hrv: d.hrvRmssdMilli, baseline: baseline[i].mean }));
  }, [data]);

  const days = useMemo(() => points.map((p) => p.day), [points]);

  // Band scale over day strings (same rationale as 4.1/4.2): every day keeps a
  // slot even when null so gaps occupy real width, and UTC-day strings never
  // round-trip through local-time Date ticks.
  const xScale = useMemo(
    () => scaleBand<string>().domain(days).range([0, dims.boundedWidth]),
    [days, dims.boundedWidth],
  );

  // ONE shared y-scale for both series — the baseline is a mean OF the HRV
  // values, so plotting them on different scales would make "above/below
  // baseline" meaningless. Fixed extent, not derived from the data.
  const yScale = useMemo(
    () => scaleLinear().domain(HRV_Y_DOMAIN).range([boundedHeight, 0]),
    [boundedHeight],
  );

  const xCenter = useMemo(() => {
    const half = xScale.bandwidth() / 2;
    return (d: HrvBaselineDatum) => (xScale(d.day) ?? 0) + half;
  }, [xScale]);

  // The `?? 0` fallbacks are unreachable — `.defined()` already excludes the
  // null days — they only satisfy the type checker (4.2 precedent).
  const baselineAreaPath = useMemo(() => {
    const generator = area<HrvBaselineDatum>()
      .defined((d) => d.baseline != null)
      .x(xCenter)
      .y0(boundedHeight)
      .y1((d) => yScale(d.baseline ?? 0));
    return generator(points) ?? '';
  }, [points, xCenter, yScale, boundedHeight]);

  const baselineEdgePath = useMemo(() => {
    const generator = line<HrvBaselineDatum>()
      .defined((d) => d.baseline != null)
      .x(xCenter)
      .y((d) => yScale(d.baseline ?? 0));
    return generator(points) ?? '';
  }, [points, xCenter, yScale]);

  const hrvLinePath = useMemo(() => {
    const generator = line<HrvBaselineDatum>()
      .defined((d) => d.hrv != null)
      .x(xCenter)
      .y((d) => yScale(d.hrv ?? 0));
    return generator(points) ?? '';
  }, [points, xCenter, yScale]);

  // Real title/desc describing the DATA, not the chart type (rule 1).
  const desc = useMemo(() => {
    if (points.length === 0) {
      return 'No data.';
    }
    const hrvs = points.map((p) => p.hrv).filter((v): v is number => v != null);
    const baselined = points.filter((p) => p.baseline != null).length;
    const first = formatDay(days[0], longDay);
    const last = formatDay(days[days.length - 1], longDay);
    const hrvRange =
      hrvs.length > 0
        ? `HRV ranges ${formatHrv(Math.min(...hrvs))} to ${formatHrv(Math.max(...hrvs))} milliseconds`
        : 'no scored HRV days';
    const baselineNote =
      baselined > 0
        ? `a 7-day rolling baseline is shown for ${baselined} of ${points.length} days`
        : 'no day has enough history for a rolling baseline yet';
    const gaps = points.filter((p) => p.hrv == null).length;
    const gapNote = gaps > 0 ? `; ${gaps} of ${points.length} days are missing HRV` : '';
    return `Daily heart rate variability with a 7-day rolling baseline, from ${first} to ${last}; ${hrvRange}; ${baselineNote}${gapNote}.`;
  }, [points, days]);

  // ~7 bottom ticks, evenly thinned — this compact tile is narrower than 4.2's
  // full-dashboard row, so fewer date labels than its 10 keeps them legible.
  const tickValues = useMemo(() => {
    const step = Math.max(1, Math.ceil(days.length / 7));
    return days.filter((_, i) => i % step === 0);
  }, [days]);

  // Rule 2: the table renders from the SAME merged rows the SVG draws — one row
  // per day. Nulls reach ChartDataTable as null so IT renders "no data".
  const tableColumns = useMemo<ChartDataColumn<HrvBaselineDatum>[]>(
    () => [
      { key: 'day', header: 'Day', value: (row) => formatDay(row.day, longDay) },
      {
        key: 'hrv',
        header: 'HRV (ms)',
        value: (row) => (row.hrv == null ? null : formatHrv(row.hrv)),
      },
      {
        key: 'baseline',
        header: 'Recent baseline (ms)',
        value: (row) => (row.baseline == null ? null : formatHrv(row.baseline)),
      },
    ],
    [],
  );

  const fadeStyle = {
    opacity: entered ? 1 : 0,
    transition: duration > 0 ? `opacity ${duration}ms ease-out` : undefined,
  };

  return (
    <div className="chart-wrapper" ref={wrapperRef}>
      {dims.width > 0 && (
        <ChartSvg width={dims.width} height={PLOT_HEIGHT} title={title} desc={desc}>
          <g transform={`translate(${dims.margin.left}, ${dims.margin.top})`}>
            <Axis scale={yScale} orientation="left" length={boundedHeight} tickCount={4} />
            <g transform={`translate(0, ${boundedHeight})`}>
              <Axis
                scale={xScale}
                orientation="bottom"
                length={dims.boundedWidth}
                tickValues={tickValues}
                format={(value) => formatDay(String(value), shortDay)}
                // Let a date label wrap rather than run into its neighbour:
                // the budget is the horizontal share each tick actually owns.
                maxLabelWidth={
                  tickValues.length > 0 ? dims.boundedWidth / tickValues.length : undefined
                }
              />
            </g>
            {/* Paths are aria-hidden: the SVG's title/desc names the chart and
                the data table (rule 2) carries every value; the focusable HRV
                points below are the keyboard/AT entry into the marks. */}
            <g aria-hidden="true" style={fadeStyle}>
              {/* Baseline area at 50% opacity (confirmed 2026-08-01, was 30%),
                  with its own edge on top in the same hue. No muted casing on
                  either — see the STROKES note in the header. */}
              <path d={baselineAreaPath} fill={BASELINE_COLOR} fillOpacity={0.5} stroke="none" />
              <path d={baselineEdgePath} fill="none" stroke={BASELINE_COLOR} strokeWidth={2} />
              <path d={hrvLinePath} fill="none" stroke={HRV_COLOR} strokeWidth={2} />
            </g>
            {/* Focusable points on the HRV line (rule 3) — one Tab stop per
                non-null HRV day; the baseline area has no focus targets of its
                own (its values ride along in the tooltip and table). */}
            {points.map((d) => {
              const bandX = xScale(d.day);
              if (d.hrv == null || bandX === undefined) {
                // Null HRV days take no Tab stop — the gap still reads "no
                // data" in the table.
                return null;
              }
              const cx = bandX + xScale.bandwidth() / 2;
              const cy = yScale(d.hrv);
              const tooltipX = dims.margin.left + cx;
              const tooltipY = dims.margin.top + cy;
              return (
                <circle
                  key={d.day}
                  className="chart-mark"
                  cx={cx}
                  cy={cy}
                  r={3.5}
                  fill={HRV_COLOR}
                  style={fadeStyle}
                  tabIndex={0}
                  role="img"
                  aria-label={`HRV ${formatHrv(d.hrv)} milliseconds, recent baseline ${
                    d.baseline == null ? 'no baseline yet' : `${formatHrv(d.baseline)} milliseconds`
                  } on ${formatDay(d.day, longDay)}`}
                  onMouseEnter={() => show(d, tooltipX, tooltipY)}
                  onMouseLeave={hide}
                  onFocus={() => show(d, tooltipX, tooltipY)}
                  onBlur={hide}
                  onKeyDown={onKeyDown}
                />
              );
            })}
          </g>
        </ChartSvg>
      )}
      {/* Identical content on hover and focus (rule 3) — one show() path. */}
      {tooltip && (
        <Tooltip x={tooltip.x} y={tooltip.y} visible>
          <strong>{formatDay(tooltip.datum.day, longDay)}</strong>
          <div>
            HRV: {tooltip.datum.hrv != null ? `${formatHrv(tooltip.datum.hrv)} ms` : 'no data'}
          </div>
          <div>
            Recent baseline:{' '}
            {tooltip.datum.baseline != null
              ? `${formatHrv(tooltip.datum.baseline)} ms`
              : 'no baseline yet'}
          </div>
        </Tooltip>
      )}
      <ChartDataTable
        caption={tableCaption}
        rowKey={(d) => d.day}
        rows={points}
        columns={tableColumns}
      />
    </div>
  );
}
