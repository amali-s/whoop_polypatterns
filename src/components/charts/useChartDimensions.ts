import { useEffect, useRef, useState } from 'react';

export interface ChartMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_MARGIN: ChartMargin = { top: 8, right: 8, bottom: 24, left: 32 };

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
