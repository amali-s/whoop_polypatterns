import { useEffect, useRef, useState } from 'react';

export interface ChartMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_MARGIN: ChartMargin = { top: 8, right: 8, bottom: 24, left: 32 };

/**
 * Shared plot height (px) for the four full-series charts — sleep stages,
 * recovery-vs-strain, HRV and RHR. Confirmed 2026-08-01 as the MOBILE target
 * (~150% of the ~213px those charts previously rendered at on a 375px
 * viewport), and the point of sharing one constant is that the four now match
 * each other exactly instead of each deriving a height from its own aspect
 * ratio.
 *
 * FLAGGED — this is a plain constant, NOT a media query. Chart height is
 * JS-driven (it goes into the SVG's viewBox), so a `@media` rule cannot reach
 * it; scoping it to the mobile breakpoint would mean a matchMedia listener,
 * i.e. exactly the JS breakpoint logic the mobile-layout-lock work (App.css)
 * just established this app does not have. It applies at every width, which
 * is currently indistinguishable from mobile-only anyway: `.bento-grid` is
 * capped at 640px and centered at every breakpoint, and dedicated
 * desktop/tablet layouts are deferred to ROADMAP 6.2. Revisit when 6.2
 * introduces real wide-viewport layouts.
 */
export const CHART_PLOT_HEIGHT = 320;

/**
 * Bottom gutter for those same four charts. Deeper than DEFAULT_MARGIN's 24
 * because x-axis tick labels may now WRAP to a second line (see Axis's
 * `maxLabelWidth`): 40px fits two 12px lines plus the tick mark without the
 * label container clipping or colliding with the plot body.
 */
export const WRAPPED_AXIS_BOTTOM_MARGIN = 40;

export interface ChartDimensions {
  /** Full outer width/height as measured from the container (viewBox size). */
  width: number;
  height: number;
  margin: ChartMargin;
  /** Inner plot area — width/height minus margins. Never negative. */
  boundedWidth: number;
  boundedHeight: number;
}

function makeDimensions(width: number, height: number, margin: ChartMargin): ChartDimensions {
  return {
    width,
    height,
    margin,
    boundedWidth: Math.max(0, width - margin.left - margin.right),
    boundedHeight: Math.max(0, height - margin.top - margin.bottom),
  };
}

/**
 * Charting foundation (4.0): makes an `<svg>` responsive by measuring its
 * parent container with ResizeObserver and recomputing on resize. Charts
 * render with `viewBox="0 0 width height"` (not fixed px attrs) so the SVG
 * scales fluidly between measurements and never blurs during a resize.
 *
 * Usage: `const [ref, dims] = useChartDimensions(); <div ref={ref}><svg viewBox={`0 0 ${dims.width} ${dims.height}`}>...`
 */
export function useChartDimensions(
  providedMargin: Partial<ChartMargin> = {},
  aspectRatio = 0.5,
): [React.RefObject<HTMLDivElement | null>, ChartDimensions] {
  const ref = useRef<HTMLDivElement | null>(null);
  const margin: ChartMargin = { ...DEFAULT_MARGIN, ...providedMargin };
  const [dimensions, setDimensions] = useState<ChartDimensions>(() => makeDimensions(0, 0, margin));

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const measure = (width: number) => {
      const height = Math.max(1, Math.round(width * aspectRatio));
      setDimensions(makeDimensions(Math.round(width), height, margin));
    };

    // Initial measurement — ResizeObserver's own first callback is
    // asynchronous, so measure synchronously too to avoid a 0x0 first paint.
    measure(element.clientWidth);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        measure(entry.contentRect.width);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
    // margin is re-spread from providedMargin every render by design (cheap,
    // avoids a stale-closure footgun); aspectRatio is expected to be static
    // per chart instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspectRatio, margin.top, margin.right, margin.bottom, margin.left]);

  return [ref, dimensions];
}
