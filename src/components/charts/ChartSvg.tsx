import { useId } from 'react';
import type { ReactNode } from 'react';

export interface ChartSvgProps {
  width: number;
  height: number;
  /** One-sentence summary of the DATA shown, not the chart type (design.md §5.2 rule 1). */
  desc: string;
  title: string;
  children: ReactNode;
  className?: string;
}

/**
 * Shared accessible SVG wrapper (4.0) — every Phase 4 chart renders through
 * this instead of a bare `<svg>`. Implements design.md §5.2 rule 1:
 * `role="img"`, `<title>`/`<desc>` wired via `aria-labelledby`, viewBox
 * sizing (from useChartDimensions) so the graphic scales fluidly.
 */
export function ChartSvg({ width, height, title, desc, children, className }: ChartSvgProps) {
  const titleId = useId();
  const descId = useId();
  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
      width="100%"
      height={height}
    >
      <title id={titleId}>{title}</title>
      <desc id={descId}>{desc}</desc>
      {children}
    </svg>
  );
}
