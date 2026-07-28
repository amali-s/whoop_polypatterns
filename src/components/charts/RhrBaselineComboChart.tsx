import { useEffect, useMemo, useState } from 'react';
import { area, line } from 'd3-shape';
import { utcFormat } from 'd3-time-format';
import { scaleBand, scaleLinear, safeExtent } from './scales';
import { useChartDimensions } from './useChartDimensions';
import { ChartSvg } from './ChartSvg';
import { Axis } from './Axis';
import { Tooltip } from './Tooltip';
import { useTooltip } from './useTooltip';
import { ChartDataTable } from './ChartDataTable';
import type { ChartDataColumn } from './ChartDataTable';
import { chartTransitionDuration } from './motion';
import { buildRollingBaseline, type DailyMetricPoint } from '../../../api/_lib/transforms';

// Combo chart (4.15): daily resting heart rate as a line OVER its own trailing
// rolling baseline as an area — the "RHR over sleep-debt area" alternative
// named in 4.3 was NOT taken; this is the direct RHR sibling of 4.3's HRV
// chart instead (same metric-vs-its-own-recent-normal shape design.md §4
// already reserves the chart-7/chart-4 token pair for), so nearly every
// decision below is inherited from HrvBaselineComboChart on purpose — a
// second metric on the identical shape is not an opportunity to re-litigate
// scale, color, or null-handling choices already made once.
//
// SINGLE-SCALE CHOICE (4.3 precedent) — line and area are the SAME quantity
// (RHR in BPM), so they share ONE zero-based y-scale, never two independent
// axes: a second axis would make "above/below baseline" meaningless.
//
// BASELINE — computed CLIENT-SIDE from the same `data` prop via the pure,
// already-tested buildRollingBaseline (api/_lib/transforms), whose own header
// comment names `p => p.restingHeartRate` as this exact variant. windowDays =
// 7 (RHR_BASELINE_WINDOW_DAYS, matching 4.3's HRV window — RHR and HRV are
// scored from the same overnight cycle, so there's no reason to give one a
// shorter "recent normal" than the other), minSamples = buildRollingBaseline's
// own default of 3 (a smoothed line, not a headline number — no stricter
// floor, the 4.3 rationale).
//
// MAPPING — design.md §4's locked "population ideal-band" for RHR is
// DEFERRED pending Phase 5 cycle-day data, identically to 4.3's HRV
// supersession. The band shown here is a trailing rolling baseline, labelled
// "Recent baseline" (never "Ideal RHR" — the static placeholder this chart
// replaces used that label, but there is no population study behind this
// band, so the copy is corrected here, not carried forward).
//
// NULL DISCIPLINE — `.defined()` on both generators so a null day BREAKS the
// path into a visible gap; the band x-domain still holds every day so the gap
// occupies real axis width (transforms.ts header, 4.1–4.3 precedent).
//
// CONTRAST (design.md §1/§4, §5.2 rule 4) — RHR actual and HRV actual
// deliberately SHARE --color-chart-7 (dark magenta, 4.5:1 — passes, no
// casing needed) and RHR/HRV baseline SHARE --color-chart-4 (pale mustard,
// 1.60:1 — fails 3:1, so its area edge wears the same muted hairline 4.3
// uses). Per design.md §1's "HRV/RHR sharing" note this is fine because the
// two metrics never appear in the same chart.

export interface RhrBaselineComboChartProps {
  /** One point per calendar day, ascending (buildDailySeries output). The baseline and data table both derive from this same prop. */
  data: readonly DailyMetricPoint[];
  /** Accessible chart name (design.md §5.2 rule 1). */
  title: string;
  /** Caption for the visually-hidden data table (rule 2). */
  tableCaption: string;
}

const RHR_COLOR = 'var(--color-chart-7)';
const BASELINE_COLOR = 'var(--color-chart-4)';

// Trailing window for the rolling baseline — matches 4.3's HRV_BASELINE_WINDOW_DAYS
// value (7) but kept as its own named constant, not a shared import, so each
// chart's window can be tuned independently later without an implicit coupling.
const RHR_BASELINE_WINDOW_DAYS = 7;

// Fixed plot height — same compact full-width bento band as 4.3 (the
// placeholder/bodyHeight this replaces was already 128px).
const PLOT_HEIGHT = 128;

// Compact axis gutters: RHR is a 2–3 digit BPM value, so the same left gutter
// as 4.3's ms labels fits; bottom/top/right are unchanged from that precedent.
const MARGIN = { top: 8, right: 10, bottom: 24, left: 36 };

const shortDay = utcFormat('%b %-d');
const longDay = utcFormat('%B %-d, %Y');

/** Format a YYYY-MM-DD day string via a UTC formatter (no local-zone day shift). Mirrors HrvBaselineComboChart's. */
function formatDay(day: string, formatter: (d: Date) => string): string {
  const date = new Date(day);
  return Number.isNaN(date.getTime()) ? day : formatter(date);
}

/** RHR to whole BPM — the precision WHOOP itself surfaces; no fractional BPM anywhere in the UI. */
function formatRhr(value: number): string {
  return String(Math.round(value));
}

/** One day's actual RHR alongside its rolling-baseline mean — the row the SVG, tooltip, and table all read. */
interface RhrBaselineDatum {
  day: string;
  /** Actual daily resting heart rate in BPM (DailyMetricPoint.restingHeartRate). */
  rhr: number | null;
  /** Trailing 7-day rolling-baseline mean in BPM, or null below minSamples. */
  baseline: number | null;
}

export function RhrBaselineComboChart({ data, title, tableCaption }: RhrBaselineComboChartProps) {
  // Pass MARGIN + an (inert) aspect ratio for boundedWidth only; the height is
  // pinned to PLOT_HEIGHT, so dims.height is ignored (Sparkline/4.3 precedent).
  const [wrapperRef, dims] = useChartDimensions(MARGIN, 0.3);
  const boundedHeight = Math.max(0, PLOT_HEIGHT - MARGIN.top - MARGIN.bottom);
  const { tooltip, show, hide, onKeyDown } = useTooltip<RhrBaselineDatum>();

  // Entrance fade, gated on reduced motion (design.md §5.2 rule 5) — same
  // fade-in pattern as HrvBaselineComboChart.
  const duration = chartTransitionDuration(400);
  const [entered, setEntered] = useState(duration === 0);
  useEffect(() => {
    if (entered) {
      return;
    }
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [entered]);

  // Merge each day's actual RHR with its trailing rolling-baseline mean.
  // buildRollingBaseline preserves order and day, so index i lines up 1:1 with
  // `data`. Spread to a mutable array — the fn only reads, but its signature
  // asks for a non-readonly DailyMetricPoint[].
  const points = useMemo<RhrBaselineDatum[]>(() => {
    const baseline = buildRollingBaseline(
      [...data],
      (p) => p.restingHeartRate,
      RHR_BASELINE_WINDOW_DAYS,
    );
    return data.map((d, i) => ({
      day: d.day,
      rhr: d.restingHeartRate,
      baseline: baseline[i].mean,
    }));
  }, [data]);

  const days = useMemo(() => points.map((p) => p.day), [points]);

  // Band scale over day strings (4.1–4.3 rationale): every day keeps a slot
  // even when null so gaps occupy real width, and UTC-day strings never
  // round-trip through local-time Date ticks.
  const xScale = useMemo(
    () => scaleBand<string>().domain(days).range([0, dims.boundedWidth]),
    [days, dims.boundedWidth],
  );

  // ONE shared y-scale, zero-based: the baseline is a mean OF the RHR values,
  // so max(RHR) bounds both series; a zero floor makes the area an honest fill.
  const rhrMax = useMemo(() => safeExtent(points, (p) => p.rhr)[1], [points]);
  const yScale = useMemo(
    () => scaleLinear().domain([0, rhrMax]).range([boundedHeight, 0]).nice(),
    [rhrMax, boundedHeight],
  );

  const xCenter = useMemo(() => {
    const half = xScale.bandwidth() / 2;
    return (d: RhrBaselineDatum) => (xScale(d.day) ?? 0) + half;
  }, [xScale]);

  // The `?? 0` fallbacks are unreachable — `.defined()` already excludes the
  // null days — they only satisfy the type checker (4.2/4.3 precedent).
  const baselineAreaPath = useMemo(() => {
    const generator = area<RhrBaselineDatum>()
      .defined((d) => d.baseline != null)
      .x(xCenter)
      .y0(boundedHeight)
      .y1((d) => yScale(d.baseline ?? 0));
    return generator(points) ?? '';
  }, [points, xCenter, yScale, boundedHeight]);

  const baselineEdgePath = useMemo(() => {
    const generator = line<RhrBaselineDatum>()
      .defined((d) => d.baseline != null)
      .x(xCenter)
      .y((d) => yScale(d.baseline ?? 0));
    return generator(points) ?? '';
  }, [points, xCenter, yScale]);

  const rhrLinePath = useMemo(() => {
    const generator = line<RhrBaselineDatum>()
      .defined((d) => d.rhr != null)
      .x(xCenter)
      .y((d) => yScale(d.rhr ?? 0));
    return generator(points) ?? '';
  }, [points, xCenter, yScale]);

  // Real title/desc describing the DATA, not the chart type (rule 1).
  const desc = useMemo(() => {
    if (points.length === 0) {
      return 'No data.';
    }
    const rhrs = points.map((p) => p.rhr).filter((v): v is number => v != null);
    const baselined = points.filter((p) => p.baseline != null).length;
    const first = formatDay(days[0], longDay);
    const last = formatDay(days[days.length - 1], longDay);
    const rhrRange =
      rhrs.length > 0
        ? `RHR ranges ${formatRhr(Math.min(...rhrs))} to ${formatRhr(Math.max(...rhrs))} beats per minute`
        : 'no scored RHR days';
    const baselineNote =
      baselined > 0
        ? `a 7-day rolling baseline is shown for ${baselined} of ${points.length} days`
        : 'no day has enough history for a rolling baseline yet';
    const gaps = points.filter((p) => p.rhr == null).length;
    const gapNote = gaps > 0 ? `; ${gaps} of ${points.length} days are missing RHR` : '';
    return `Daily resting heart rate with a 7-day rolling baseline, from ${first} to ${last}; ${rhrRange}; ${baselineNote}${gapNote}.`;
  }, [points, days]);

  // ~7 bottom ticks, evenly thinned — matches 4.3's compact-tile tick density.
  const tickValues = useMemo(() => {
    const step = Math.max(1, Math.ceil(days.length / 7));
    return days.filter((_, i) => i % step === 0);
  }, [days]);

  // Rule 2: the table renders from the SAME merged rows the SVG draws — one row
  // per day. Nulls reach ChartDataTable as null so IT renders "no data".
  const tableColumns = useMemo<ChartDataColumn<RhrBaselineDatum>[]>(
    () => [
      { key: 'day', header: 'Day', value: (row) => formatDay(row.day, longDay) },
      {
        key: 'rhr',
        header: 'RHR (BPM)',
        value: (row) => (row.rhr == null ? null : formatRhr(row.rhr)),
      },
      {
        key: 'baseline',
        header: 'Recent baseline (BPM)',
        value: (row) => (row.baseline == null ? null : formatRhr(row.baseline)),
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
              />
            </g>
            {/* Paths are aria-hidden: the SVG's title/desc names the chart and
                the data table (rule 2) carries every value; the focusable RHR
                points below are the keyboard/AT entry into the marks. */}
            <g aria-hidden="true" style={fadeStyle}>
              <path d={baselineAreaPath} fill={BASELINE_COLOR} fillOpacity={0.3} stroke="none" />
              {/* Muted casing under the baseline edge: pale mustard
                  (--color-chart-4) fails 3:1 against the white card (rule 4),
                  so it wears the same hairline the legend swatches and 4.3's
                  baseline line do. */}
              <path d={baselineEdgePath} fill="none" stroke="var(--color-muted)" strokeWidth={3} />
              <path d={baselineEdgePath} fill="none" stroke={BASELINE_COLOR} strokeWidth={2} />
              {/* RHR actual line: --color-chart-7 passes 4.5:1, so no casing. */}
              <path d={rhrLinePath} fill="none" stroke={RHR_COLOR} strokeWidth={2} />
            </g>
            {/* Focusable points on the RHR line (rule 3) — one Tab stop per
                non-null RHR day; the baseline area has no focus targets of its
                own (its values ride along in the tooltip and table). */}
            {points.map((d) => {
              const bandX = xScale(d.day);
              if (d.rhr == null || bandX === undefined) {
                // Null RHR days take no Tab stop — the gap still reads "no
                // data" in the table.
                return null;
              }
              const cx = bandX + xScale.bandwidth() / 2;
              const cy = yScale(d.rhr);
              const tooltipX = dims.margin.left + cx;
              const tooltipY = dims.margin.top + cy;
              return (
                <circle
                  key={d.day}
                  className="chart-mark"
                  cx={cx}
                  cy={cy}
                  r={3.5}
                  fill={RHR_COLOR}
                  stroke="var(--color-muted)"
                  strokeWidth={1}
                  style={fadeStyle}
                  tabIndex={0}
                  role="img"
                  aria-label={`RHR ${formatRhr(d.rhr)} beats per minute, recent baseline ${
                    d.baseline == null
                      ? 'no baseline yet'
                      : `${formatRhr(d.baseline)} beats per minute`
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
            RHR: {tooltip.datum.rhr != null ? `${formatRhr(tooltip.datum.rhr)} bpm` : 'no data'}
          </div>
          <div>
            Recent baseline:{' '}
            {tooltip.datum.baseline != null
              ? `${formatRhr(tooltip.datum.baseline)} bpm`
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
