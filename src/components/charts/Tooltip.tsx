import type { ReactNode } from 'react';

export interface TooltipProps {
  x: number;
  y: number;
  visible: boolean;
  children: ReactNode;
}

/**
 * Shared floating tooltip (4.0). Positioned absolutely inside a
 * `position: relative` chart wrapper at the SVG pixel coords the caller
 * supplies (same coords a d3 pointer/scale computes). Shown on hover OR
 * focus by the caller — this component only renders the box; rule 3
 * (design.md §5.2) requires the point that opens it to be keyboard-reachable
 * and to dismiss on Escape/blur, which each chart wires via onFocus/onBlur/
 * onKeyDown alongside onMouseEnter/onMouseLeave.
 */
export function Tooltip({ x, y, visible, children }: TooltipProps) {
  if (!visible) {
    return null;
  }
  return (
    <div className="chart-tooltip" role="tooltip" style={{ left: x, top: y }}>
      {children}
    </div>
  );
}
