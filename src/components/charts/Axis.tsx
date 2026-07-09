import { useMemo } from 'react';
import type { ScaleBand, ScaleLinear, ScaleTime } from 'd3-scale';
import { timeFormat } from 'd3-time-format';
import { format as numberFormat } from 'd3-format';

// React owns the DOM here on purpose (design.md's "React owns SVG/state, D3
// owns scales/shapes" split): D3 only supplies the scale + its tick values,
// React renders the <g>/<line>/<text> elements declaratively instead of a
// d3.axis() imperative call into a ref. Keeps every label real DOM text
// (screen-reader reachable, no re-derivation) rather than D3-injected nodes.

type AnyScale = ScaleLinear<number, number> | ScaleTime<number, number> | ScaleBand<string>;

function isBandScale(scale: AnyScale): scale is ScaleBand<string> {
  return typeof (scale as ScaleBand<string>).bandwidth === 'function';
}

function tickPosition(scale: AnyScale, value: string | number | Date): number {
  if (isBandScale(scale)) {
    return (scale(String(value)) ?? 0) + scale.bandwidth() / 2;
  }
  return (scale as ScaleLinear<number, number>)(value as never);
}

export interface AxisProps {
  scale: AnyScale;
  orientation: 'bottom' | 'left';
  /** Plot-area length along the axis (boundedWidth for bottom, boundedHeight for left). */
  length: number;
  tickCount?: number;
  /** Override tick values (band scales use their domain by default). */
  tickValues?: (string | number | Date)[];
  format?: (value: string | number | Date) => string;
  label?: string;
}

const dayFormat = timeFormat('%b %-d');
const defaultNumberFormat = numberFormat('~s');

function defaultFormat(value: string | number | Date): string {
  if (value instanceof Date) {
    return dayFormat(value);
  }
  if (typeof value === 'number') {
    return defaultNumberFormat(value);
  }
  return String(value);
}

/** Shared bottom/left axis — used by every Phase 4 chart for consistent ticks/labels. */
export function Axis({
  scale,
  orientation,
  length,
  tickCount = 5,
  tickValues,
  format = defaultFormat,
  label,
}: AxisProps) {
  const values = useMemo<(string | number | Date)[]>(() => {
    if (tickValues) {
      return tickValues;
    }
    if (isBandScale(scale)) {
      return scale.domain();
    }
    if ('ticks' in scale && typeof scale.ticks === 'function') {
      return (scale as ScaleLinear<number, number>).ticks(tickCount);
    }
    return [];
  }, [scale, tickCount, tickValues]);

  const isBottom = orientation === 'bottom';

  return (
    <g className={`chart-axis chart-axis-${orientation}`} aria-hidden="true">
      <line x1={0} y1={0} x2={isBottom ? length : 0} y2={isBottom ? 0 : length} />
      {values.map((value, i) => {
        const pos = tickPosition(scale, value);
        const key = value instanceof Date ? value.toISOString() : String(value);
        return (
          <g key={key ?? i} transform={isBottom ? `translate(${pos}, 0)` : `translate(0, ${pos})`}>
            <line x1={0} y1={0} x2={isBottom ? 0 : -4} y2={isBottom ? 4 : 0} />
            <text
              x={isBottom ? 0 : -8}
              y={isBottom ? 16 : 0}
              dy={isBottom ? undefined : '0.32em'}
              textAnchor={isBottom ? 'middle' : 'end'}
            >
              {format(value)}
            </text>
          </g>
        );
      })}
      {label && (
        <text
          className="chart-axis-label"
          x={isBottom ? length / 2 : -length / 2}
          y={isBottom ? 34 : -24}
          textAnchor="middle"
          transform={isBottom ? undefined : 'rotate(-90)'}
        >
          {label}
        </text>
      )}
    </g>
  );
}
