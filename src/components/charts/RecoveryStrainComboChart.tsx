import { useEffect, useMemo, useState } from 'react';
import { area, line } from 'd3-shape';
import { utcFormat } from 'd3-time-format';
import { scaleBand, scaleLinear, safeExtent } from './scales';
import { useChartDimensions } from './useChartDimensions';
import { ChartSvg } from './ChartSvg';
import { Axis } from './Axis';
import { Legend } from './Legend';
import { Tooltip } from './Tooltip';
import { useTooltip } from './useTooltip';
import { ChartDataTable } from './ChartDataTable';
import type { ChartDataColumn } from './ChartDataTable';
import { chartTransitionDuration } from './motion';
import type { DailyMetricPoint } from '../../../api/_lib/transforms';

// Combo chart (4.2): Recovery % as a line OVER day strain as an area, one x
// (day) scale, TWO independent y scales — readiness vs. load on the same day
// axis. Deliberately NOT generic over T like StackedBarChart: this is a fixed
// metric pairing (recoveryScore + strain off DailyMetricPoint), and a second
// axis only makes sense when the two units are known to the component.
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

const RECOVERY_COLOR = 'var(--color-chart-6)';
const STRAIN_COLOR = 'var(--color-chart-5)';

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
  // Symmetric left/right margins: this chart carries an axis on BOTH edges.
  const [wrapperRef, dims] = useChartDimensions({ left: 44, right: 44, bottom: 28 }, 0.32);
  const { tooltip, show, hide, onKeyDown } = useTooltip<DailyMetricPoint>();

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
    () => scaleLinear().domain([0, 100]).range([dims.boundedHeight, 0]),
    [dims.boundedHeight],
  );

  const strainMax = useMemo(() => safeExtent(data, (d) => d.strain)[1], [data]);
  const strainScale = useMemo(
    () => scaleLinear().domain([0, strainMax]).range([dims.boundedHeight, 0]).nice(),
    [strainMax, dims.boundedHeight],
  );

  const xCenter = useMemo(() => {
    const half = xScale.bandwidth() / 2;
    return (d: DailyMetricPoint) => (xScale(d.day) ?? 0) + half;
  }, [xScale]);

  // The `?? 0` fallbacks below are unreachable — `.defined()` already excludes
  // null days from each segment — they only satisfy the type checker without
  // an assertion.
  const strainAreaPath = useMemo(() => {
    const generator = area<DailyMetricPoint>()
      .defined((d) => d.strain != null)
      .x(xCenter)
      .y0(dims.boundedHeight)
      .y1((d) => strainScale(d.strain ?? 0));
    return generator(data) ?? '';
  }, [data, xCenter, strainScale, dims.boundedHeight]);

  // Crisp full-opacity top edge on the strain area: the reduced-opacity fill
  // alone would fail the 3:1 non-text boundary (design.md §5.2 rule 4).
  const strainEdgePath = useMemo(() => {
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

  return (
    <div className="chart-wrapper" ref={wrapperRef}>
      {dims.width > 0 && (
        <ChartSvg width={dims.width} height={dims.height} title={title} desc={desc}>
          <g transform={`translate(${dims.margin.left}, ${dims.margin.top})`}>
            <Axis scale={recoveryScale} orientation="left" length={dims.boundedHeight} />
            {/* Strain's axis lives on the right edge — a translated LEFT axis
                would paint its tick labels inside the plot, over the area. */}
            <g transform={`translate(${dims.boundedWidth}, 0)`}>
              <Axis scale={strainScale} orientation="right" length={dims.boundedHeight} />
            </g>
            <g transform={`translate(0, ${dims.boundedHeight})`}>
              <Axis
                scale={xScale}
                orientation="bottom"
                length={dims.boundedWidth}
                tickValues={tickValues}
                format={(value) => formatDay(String(value), shortDay)}
              />
            </g>
            {/* Paths are aria-hidden: the SVG's title/desc names the chart and
                the data table (rule 2) carries every value; the focusable
                recovery points below are the keyboard/AT entry into the marks. */}
            <g aria-hidden="true" style={fadeStyle}>
              <path d={strainAreaPath} fill={STRAIN_COLOR} fillOpacity={0.3} stroke="none" />
              <path d={strainEdgePath} fill="none" stroke={STRAIN_COLOR} strokeWidth={2} />
              {/* Muted casing under the recovery line: lime (--color-chart-6)
                  fails 3:1 against the white card (rule 4), so it wears the
                  same hairline the legend swatches and 4.1's bar segments do. */}
              <path d={recoveryLinePath} fill="none" stroke="var(--color-muted)" strokeWidth={4} />
              <path d={recoveryLinePath} fill="none" stroke={RECOVERY_COLOR} strokeWidth={2} />
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
                  r={3.5}
                  fill={RECOVERY_COLOR}
                  stroke="var(--color-muted)"
                  strokeWidth={1}
                  style={fadeStyle}
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
        <Tooltip x={tooltip.x} y={tooltip.y} visible>
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
