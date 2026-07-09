import { useCallback, useState } from 'react';

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
 */
export function useTooltip<T>() {
  const [tooltip, setTooltip] = useState<TooltipState<T> | null>(null);

  const show = useCallback((datum: T, x: number, y: number) => {
    setTooltip({ datum, x, y });
  }, []);

  const hide = useCallback(() => {
    setTooltip(null);
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        hide();
      }
    },
    [hide],
  );

  return { tooltip, show, hide, onKeyDown };
}
