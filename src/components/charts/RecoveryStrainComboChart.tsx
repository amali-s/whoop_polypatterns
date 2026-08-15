import { useEffect, useMemo, useState } from 'react';
import { line } from 'd3-shape';
import { utcFormat } from 'd3-time-format';
import { scaleBand, scaleLinear, safeExtent } from './scales';
import {
  useChartDimensions,
  CHART_PLOT_HEIGHT,
  WRAPPED_AXIS_BOTTOM_MARGIN,
} from './useChartDimensions';
import { ChartSvg } from './ChartSvg';
import { Axis } from './Axis';
import { Legend } from './Legend';
import { Tooltip } from './Tooltip';
import { useTooltip } from './useTooltip';
import { ChartDataTable } from './ChartDataTable';
import type { ChartDataColumn } from './ChartDataTable';
import { chartMarkStyle, chartTransitionDuration } from './motion';
import type { DailyMetricPoint } from '../../../api/_lib/transforms';

// Combo chart (4.2): Recovery % and day strain as TWO LINES on one x (day)
// scale with two independent y scales — readiness vs. load on the same day
// axis. Deliberately NOT generic over T like StackedBarChart: this is a fixed
// metric pairing (recoveryScore + strain off DailyMetricPoint), and a second
// axis only makes sense when the two units are known to the component.
//
// STRAIN IS A PLAIN LINE as of 2026-08-01 (confirmed): the area fill beneath
// it is gone. Two lines is the honest shape here anyway — an area reads as an
// accumulated magnitude, and the chart's point is comparing the two daily
// series against each other, not weighing strain's mass. The name "combo
// chart" is kept because the component, its props and its tile wiring are
// otherwise unchanged.
//
// STROKES — the --color-muted outline on the recovery points is removed
// (confirmed), as is the hairline on the legend swatches. The muted CASING
// under the recovery LINE is now removed TOO (2026-08-01, second pass,
// explicitly requested).
//
// FLAGGED, not silently shipped: that casing was §5.2 rule 4's contrast
// remedy for this line. #6BCB3C is 2.05:1 on the white card and 1.89:1 on the
// translucent tile, so the recovery line no longer clears the 3:1 non-text
// threshold on its own. RECOVERY_COLOR was left alone rather than darkened
// because --color-positive is deliberately the same green the recovery ring
// fills with (see below), and breaking that agreement is a design call, not a
// cleanup. What rule 4 now rests on here is its OTHER half — redundant
// encoding: the legend names "Recovery %" in real text, every point carries an
// aria-label, every value is in the tooltip and in the sr-only data table, and
// the two series sit on separate labelled axes. That is the same trade the
// HRV/RHR lines (#FFA1A0, 1.93:1) run under since the 2026-08-01 pass — this
// line was the last one still wearing a casing, so the chart is at least now
// internally consistent. (The strain line itself no longer relies on that
// trade: 6.2b deepened --color-chart-5 to #0088CC, 3.95:1 white / 3.62:1 tile,
// which clears 3:1 on its own.)
// If the trade turns out wrong, a darker green in the same hue family —
// #4E9E1E, computed 3.37:1 on white and 3.10:1 on the tile — clears 3:1 on
// its own and is a one-constant change to RECOVERY_COLOR below.
//
// DUAL-SCALE CHOICE: recovery is a bounded percentage (left axis, fixed
// [0, 100] so 50% always sits mid-chart regardless of the window's values);
// strain is WHOOP's open-ended 0–21ish score (right axis, [0, data max]
// niced). Sharing one scale would flatten strain into the bottom fifth.
//
// NULL DISCIPLINE (transforms.ts header): both generators use `.defined()` so
// a null day BREAKS the path into a visible gap — never drawn through at 0,
// never interpolated across. The x domain still contains every day (same as
// StackedBarChart keeping null-total days in its band domain), so the gap
// occupies real axis space.

export interface RecoveryStrainComboChartProps {
  /** One point per calendar day, ascending (buildDailySeries output). The data table renders from this same prop. */
  data: readonly DailyMetricPoint[];
  /** Accessible chart name (design.md §5.2 rule 1). */
  title: string;
  /** Caption for the visually-hidden data table (rule 2). */
  tableCaption: string;
}

// Recovery reads --color-positive (#6BCB3C), NOT the old --color-chart-6:
// after the 2026-08-01 token pass, --color-positive IS the recovery green —
// the same value the recovery ring's green zone fills with — so the line and
// the ring finally agree. Strain keeps --color-chart-5, deepened to #0088CC
// in the 6.2b pass (was #02B3FF) so the strain mark clears 3:1 on its own.
const RECOVERY_COLOR = 'var(--color-positive)';
const STRAIN_COLOR = 'var(--color-chart-5)';

// Fixed plot height — the shared CHART_PLOT_HEIGHT (320px). Replaces this
// chart's old aspect-ratio height (0.32 x width), which made it a different
// size from the HRV/RHR tiles at every viewport; the four full-series charts
// are now one size (confirmed 2026-08-01).
const PLOT_HEIGHT = CHART_PLOT_HEIGHT;

// Symmetric left/right gutters: this chart carries an axis on BOTH edges. The
// bottom uses the shared deeper gutter because x labels may wrap to two lines.
const MARGIN = {
  top: 8,
  left: 44,
  right: 44,
  bottom: WRAPPED_AXIS_BOTTOM_MARGIN,
};

const shortDay = utcFormat('%b %-d');
const longDay = utcFormat('%B %-d, %Y');

/** Format a YYYY-MM-DD day string via a UTC formatter (no local-zone day shift). Mirrors StackedBarChart's. */
function formatDay(day: string, formatter: (d: Date) => string): string {
  const date = new Date(day);
  return Number.isNaN(date.getTime()) ? day : formatter(date);
}

/** Strain to one decimal — the precision WHOOP itself surfaces; more is noise. */
function formatStrain(value: number): string {
  return value.toFixed(1);
}

export function RecoveryStrainComboChart({
  data,
  title,
  tableCaption,
}: RecoveryStrainComboChartProps) {
  // Pass MARGIN + an (inert) aspect ratio for boundedWidth only; the height is
  // pinned to PLOT_HEIGHT, so dims.height is ignored (the 4.3/4.15 precedent).
  const [wrapperRef, dims] = useChartDimensions(MARGIN, 0.32);
  const boundedHeight = Math.max(0, PLOT_HEIGHT - MARGIN.top - MARGIN.bottom);
  const { tooltip, visible, show, hide, onKeyDown } = useTooltip<DailyMetricPoint>();

  // Entrance animation, gated on reduced motion (design.md §5.2 rule 5) —
  // same fade-in pattern as StackedBarChart.
  const duration = chartTransitionDuration(400);
  const [entered, setEntered] = useState(duration === 0);
  useEffect(() => {
    if (entered) {
      return;
    }
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [entered]);

  const days = useMemo(() => data.map((d) => d.day), [data]);

  // Band scale over day strings (marks sit at band centers) rather than
  // scaleTime: every day keeps a slot even when fully null (gaps occupy real
  // width, matching 4.1's axis behavior), and day strings never round-trip
  // through local-time Date ticks — scaleTime's ticks are LOCAL midnights,
  // which would drift a day off these UTC-day strings in +UTC zones.
  const xScale = useMemo(
    () => scaleBand<string>().domain(days).range([0, dims.boundedWidth]),
    [days, dims.boundedWidth],
  );

  // Recovery: fixed percentage domain — never rescaled to the data, so a bad
  // week doesn't visually inflate into a good one.
  const recoveryScale = useMemo(
    () => scaleLinear().domain([0, 100]).range([boundedHeight, 0]),
    [boundedHeight],
  );

  const strainMax = useMemo(() => safeExtent(data, (d) => d.strain)[1], [data]);
  const strainScale = useMemo(
    () => scaleLinear().domain([0, strainMax]).range([boundedHeight, 0]).nice(),
    [strainMax, boundedHeight],
  );

  const xCenter = useMemo(() => {
    const half = xScale.bandwidth() / 2;
    return (d: DailyMetricPoint) => (xScale(d.day) ?? 0) + half;
  }, [xScale]);

  // The `?? 0` fallbacks below are unreachable — `.defined()` already excludes
  // null days from each segment — they only satisfy the type checker without
  // an assertion.
  //
  // One path for strain since 2026-08-01: the area generator (and its separate
  // `y0` baseline) is gone, so this IS the strain series, not the top edge of
  // a fill.
  const strainLinePath = useMemo(() => {
    const generator = line<DailyMetricPoint>()
      .defined((d) => d.strain != null)
      .x(xCenter)
      .y((d) => strainScale(d.strain ?? 0));
    return generator(data) ?? '';
  }, [data, xCenter, strainScale]);

  const recoveryLinePath = useMemo(() => {
    const generator = line<DailyMetricPoint>()
      .defined((d) => d.recoveryScore != null)
      .x(xCenter)
      .y((d) => recoveryScale(d.recoveryScore ?? 0));
    return generator(data) ?? '';
  }, [data, xCenter, recoveryScale]);

  // Real title/desc describing the DATA, not the chart type (rule 1).
  const desc = useMemo(() => {
    if (data.length === 0) {
      return 'No data.';
    }
    const recoveries = data.map((d) => d.recoveryScore).filter((v): v is number => v != null);
    const strains = data.map((d) => d.strain).filter((v): v is number => v != null);
    const first = formatDay(days[0], longDay);
    const last = formatDay(days[days.length - 1], longDay);
    const recoveryRange =
      recoveries.length > 0
        ? `recovery ranges ${Math.min(...recoveries)} to ${Math.max(...recoveries)} percent`
        : 'no scored recovery days';
    const strainRange =
      strains.length > 0
        ? `day strain ranges ${formatStrain(Math.min(...strains))} to ${formatStrain(Math.max(...strains))}`
        : 'no scored strain days';
    const gaps = data.filter((d) => d.recoveryScore == null || d.strain == null).length;
    const gapNote =
      gaps > 0 ? `; ${gaps} of ${data.length} days are missing one or both metrics` : '';
    return `Recovery percent and day strain per day from ${first} to ${last}; ${recoveryRange}; ${strainRange}${gapNote}.`;
  }, [data, days]);

  // ~10 bottom ticks, evenly thinned — 30+ day labels would overlap.
  const tickValues = useMemo(() => {
    const step = Math.max(1, Math.ceil(days.length / 10));
    return days.filter((_, i) => i % step === 0);
  }, [days]);

  // Rule 2: the table renders from the SAME `data` prop the SVG draws — one
  // row per day. Nulls read "no data".
  const tableColumns = useMemo<ChartDataColumn<DailyMetricPoint>[]>(
    () => [
      { key: 'day', header: 'Day', value: (row) => formatDay(row.day, longDay) },
      { key: 'recovery', header: 'Recovery %', value: (row) => row.recoveryScore },
      {
        key: 'strain',
        header: 'Day strain',
        value: (row) => (row.strain == null ? null : formatStrain(row.strain)),
      },
    ],
    [],
  );

  const fadeStyle = {
    opacity: entered ? 1 : 0,
    transition: duration > 0 ? `opacity ${duration}ms ease-out` : undefined,
  };

  // The marks take the same entrance fade but hand its duration to charts.css
  // as a custom property instead of an inline `transition` shorthand — the
  // shorthand would have outranked the hover/focus transition on .chart-mark.
  const markStyle = chartMarkStyle(entered, duration);

  return (
    <div className="chart-wrapper" ref={wrapperRef}>
      {dims.width > 0 && (
        <ChartSvg width={dims.width} height={PLOT_HEIGHT} title={title} desc={desc}>
          <g transform={`translate(${dims.margin.left}, ${dims.margin.top})`}>
            <Axis scale={recoveryScale} orientation="left" length={boundedHeight} />
            {/* Strain's axis lives on the right edge — a translated LEFT axis
                would paint its tick labels inside the plot, over the lines. */}
            <g transform={`translate(${dims.boundedWidth}, 0)`}>
              <Axis scale={strainScale} orientation="right" length={boundedHeight} />
            </g>
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
                the data table (rule 2) carries every value; the focusable
                recovery points below are the keyboard/AT entry into the marks. */}
            <g aria-hidden="true" style={fadeStyle}>
              {/* Strain: a plain line, no area fill (2026-08-01). */}
              <path d={strainLinePath} fill="none" stroke={STRAIN_COLOR} strokeWidth={1.5} />
              {/* Recovery: a bare line as of 2026-08-01 — the --color-muted
                  strokeWidth={4} casing that used to sit under it is REMOVED at
                  the user's direction, and the contrast cost was flagged back
                  rather than absorbed silently. See the STROKES note in the
                  header for what now carries rule 4 here. */}
              <path d={recoveryLinePath} fill="none" stroke={RECOVERY_COLOR} strokeWidth={1.5} />
            </g>
            {/* Focusable points on the recovery line (rule 3) — one Tab stop
                per non-null recovery day; the area has no focus targets of its
                own (its values ride along in the tooltip and table). */}
            {data.map((d) => {
              const bandX = xScale(d.day);
              if (d.recoveryScore == null || bandX === undefined) {
                // Null recovery days take no Tab stop — the gap still reads
                // "no data" in the table.
                return null;
              }
              const cx = bandX + xScale.bandwidth() / 2;
              const cy = recoveryScale(d.recoveryScore);
              const tooltipX = dims.margin.left + cx;
              const tooltipY = dims.margin.top + cy;
              return (
                <circle
                  key={d.day}
                  className="chart-mark"
                  cx={cx}
                  cy={cy}
                  r={2.5}
                  fill={RECOVERY_COLOR}
                  style={markStyle}
                  tabIndex={0}
                  role="img"
                  aria-label={`Recovery ${d.recoveryScore} percent, day strain ${
                    d.strain == null ? 'no data' : formatStrain(d.strain)
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
        <Tooltip x={tooltip.x} y={tooltip.y} visible={visible}>
          <strong>{formatDay(tooltip.datum.day, longDay)}</strong>
          <div>
            Recovery:{' '}
            {tooltip.datum.recoveryScore != null ? `${tooltip.datum.recoveryScore}%` : 'no data'}
          </div>
          <div>
            Day strain:{' '}
            {tooltip.datum.strain != null ? formatStrain(tooltip.datum.strain) : 'no data'}
          </div>
        </Tooltip>
      )}
      <ChartDataTable
        caption={tableCaption}
        rowKey={(d) => d.day}
        rows={data}
        columns={tableColumns}
      />
      {/* Rule 6: swatch + real text label per series; Legend borders the swatch. */}
      <div className="ui-chart-legend">
        <Legend
          entries={[
            { key: 'recovery', label: 'Recovery %', color: RECOVERY_COLOR },
            { key: 'strain', label: 'Day strain', color: STRAIN_COLOR },
          ]}
        />
      </div>
    </div>
  );
}
