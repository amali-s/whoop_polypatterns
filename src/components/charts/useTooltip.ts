import { useCallback, useEffect, useRef, useState } from 'react';
import { CHART_HOVER_DURATION, chartTransitionDuration } from './motion';

export interface TooltipState<T> {
  datum: T;
  x: number;
  y: number;
}

/**
 * Shared hover/focus tooltip state (4.0 scaffold; wired per-chart in 4.7).
 * One entry point (`show`) is called from both mouse and focus handlers so
 * hover and keyboard focus produce the identical tooltip (design.md §5.2
 * rule 3); `hide` is called from mouseleave, blur, and Escape.
 *
 * DEFERRED UNMOUNT (2026-08-01). `hide()` used to null the datum synchronously,
 * which unmounted the tooltip on the same frame — there was no "leaving" state
 * for CSS to animate, so the box just vanished. It now flips `visible` false
 * and keeps the datum mounted for the length of the exit transition, then
 * clears it. Callers get a second flag; nothing else about the contract moves,
 * and the charts stay free of timing logic (one implementation here, not five).
 */
export function useTooltip<T>() {
  const [tooltip, setTooltip] = useState<TooltipState<T> | null>(null);
  const [visible, setVisible] = useState(false);
  // Not state: a pending unmount must be cancellable from show() without
  // re-rendering, and it must survive the re-render hide() itself causes.
  const exitTimer = useRef<number | null>(null);

  const cancelExit = useCallback(() => {
    if (exitTimer.current !== null) {
      window.clearTimeout(exitTimer.current);
      exitTimer.current = null;
    }
  }, []);

  const show = useCallback(
    (datum: T, x: number, y: number) => {
      // Re-entering during an exit adopts the new datum and cancels the
      // unmount — moving between adjacent points never blanks the tooltip.
      cancelExit();
      setTooltip({ datum, x, y });
      setVisible(true);
    },
    [cancelExit],
  );

  const hide = useCallback(() => {
    cancelExit();
    setVisible(false);
    // Matches the CSS exit exactly (charts.css .chart-tooltip[data-leaving]);
    // a timeout rather than transitionend because the element is at opacity 1
    // with nothing to interpolate when reduced motion has killed the
    // transition — transitionend would never fire and the tooltip would stay
    // mounted forever.
    exitTimer.current = window.setTimeout(() => {
      exitTimer.current = null;
      setTooltip(null);
    }, chartTransitionDuration(CHART_HOVER_DURATION));
  }, [cancelExit]);

  // A chart unmounting mid-exit (tile swap, range change) must not leave a
  // timer pointing at a dead setState.
  useEffect(() => cancelExit, [cancelExit]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        hide();
      }
    },
    [hide],
  );

  return { tooltip, visible, show, hide, onKeyDown };
}
