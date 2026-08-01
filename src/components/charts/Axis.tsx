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
  /** 'right' (added 4.2, dual-scale combo): same vertical line as 'left' but
   *  ticks/labels grow rightward — for an axis on the plot's right edge, where
   *  a translated left axis would paint its labels inside the plot area. */
  orientation: 'bottom' | 'left' | 'right';
  /** Plot-area length along the axis (boundedWidth for bottom, boundedHeight for left). */
  length: number;
  tickCount?: number;
  /** Override tick values (band scales use their domain by default). */
  tickValues?: (string | number | Date)[];
  format?: (value: string | number | Date) => string;
  label?: string;
  /**
   * Bottom axis only (added 2026-08-01). Horizontal space in px each tick
   * label may occupy before it WRAPS onto a second line. SVG `<text>` never
   * wraps on its own, so without this a long label just runs into (and
   * overlaps) its neighbours — the failure this prop exists to fix.
   *
   * Omitted = the pre-2026-08-01 behavior: one line, no wrapping, ever.
   */
  maxLabelWidth?: number;
}

/**
 * Rough advance width of a label at the axis font size (--text-xs, 12px).
 * 0.58em per character is a conservative average for a humanist sans at small
 * sizes — SVG gives us no measurement API before paint, and the alternative
 * (render, measure, re-render) would cost a layout thrash on every resize for
 * a decision that only needs to be approximately right.
 */
const AXIS_CHAR_WIDTH = 12 * 0.58;

/**
 * Split a tick label across at most two lines when it won't fit `maxWidth`.
 * Breaks at the LAST space that still leaves the first line under budget, so
 * "Jul 5" stays whole at any realistic tick spacing and only genuinely long
 * labels split. Returns a single-element array when it fits or has no space
 * to break at — a hyphenless mid-word break would be worse than the overlap.
 */
function wrapTickLabel(text: string, maxWidth: number | undefined): string[] {
  if (maxWidth === undefined || text.length * AXIS_CHAR_WIDTH <= maxWidth) {
    return [text];
  }
  const words = text.split(' ');
  if (words.length < 2) {
    return [text];
  }
  let split = 1;
  for (let i = 1; i < words.length; i++) {
    if (words.slice(0, i).join(' ').length * AXIS_CHAR_WIDTH > maxWidth) {
      break;
    }
    split = i;
  }
  return [words.slice(0, split).join(' '), words.slice(split).join(' ')];
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
  maxLabelWidth,
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
  // 'right' shares the vertical domain line with 'left'; only the tick marks,
  // label offsets, and anchoring mirror to the +x side.
  const isRight = orientation === 'right';

  return (
    <g className={`chart-axis chart-axis-${orientation}`} aria-hidden="true">
      <line x1={0} y1={0} x2={isBottom ? length : 0} y2={isBottom ? 0 : length} />
      {values.map((value, i) => {
        const pos = tickPosition(scale, value);
        const key = value instanceof Date ? value.toISOString() : String(value);
        // Bottom labels may wrap to a second line (see wrapTickLabel); every
        // other orientation stays single-line as before.
        const lines = isBottom ? wrapTickLabel(format(value), maxLabelWidth) : [format(value)];
        return (
          <g key={key ?? i} transform={isBottom ? `translate(${pos}, 0)` : `translate(0, ${pos})`}>
            <line x1={0} y1={0} x2={isBottom ? 0 : isRight ? 4 : -4} y2={isBottom ? 4 : 0} />
            <text
              x={isBottom ? 0 : isRight ? 8 : -8}
              y={isBottom ? 16 : 0}
              dy={isBottom ? undefined : '0.32em'}
              textAnchor={isBottom ? 'middle' : isRight ? 'start' : 'end'}
            >
              {lines.length === 1
                ? lines[0]
                : lines.map((lineText, lineIndex) => (
                    // x is repeated per tspan so line 2 re-anchors at the tick
                    // rather than continuing from where line 1 ended.
                    <tspan key={lineText} x={0} dy={lineIndex === 0 ? 0 : '1.15em'}>
                      {lineText}
                    </tspan>
                  ))}
            </text>
          </g>
        );
      })}
      {label && (
        <text
          className="chart-axis-label"
          x={isBottom || isRight ? length / 2 : -length / 2}
          y={isBottom ? 34 : isRight ? -34 : -24}
          textAnchor="middle"
          transform={isBottom ? undefined : isRight ? 'rotate(90)' : 'rotate(-90)'}
        >
          {label}
        </text>
      )}
    </g>
  );
}
