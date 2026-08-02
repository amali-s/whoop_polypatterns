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
 *
 * `visible` is no longer a mount gate (2026-08-01). Returning null on
 * `!visible` meant the box left the DOM on the same frame hide() ran, so its
 * exit could never animate; useTooltip now holds the datum for the length of
 * the transition and this renders through it, stamped `data-leaving` for
 * charts.css to animate out. Whether the tooltip exists at all stays the
 * caller's `{tooltip && ...}` — unchanged.
 */
export function Tooltip({ x, y, visible, children }: TooltipProps) {
  return (
    <div
      className="chart-tooltip"
      role="tooltip"
      data-leaving={visible ? undefined : 'true'}
      style={{ left: x, top: y }}
    >
      {children}
    </div>
  );
}
