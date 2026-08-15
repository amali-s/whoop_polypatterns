import { useId } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Card } from './Card';
import { LoadingState, EmptyState, ErrorState } from './states';
import './components.css';

export type ChartStatus = 'ready' | 'loading' | 'empty' | 'error';

export interface ChartContainerProps {
  title: string;
  /** Small muted line under the title (e.g. the journal "Stub — Phase 5" tag). */
  subtitle?: ReactNode;
  /**
   * 'ready' renders children; the other three swap the body for the matching
   * state component. Defaults to 'ready' — in task 3.3 every tile passes its
   * static placeholder markup as ready children, and Phase 4 flips this from
   * real fetch state without touching this component.
   */
  status?: ChartStatus;
  /**
   * Fixed body height in px — owned the per-tile placeholder sizing (23/64/128)
   * that was hardcoded in App.css. Omit it and the body sizes to content;
   * Phase 4's responsive D3 charts drop the prop rather than fight it.
   *
   * NO CONSUMERS as of 2026-08-01: the last two (the HRV and RHR tiles, still
   * pinning their placeholders' 128px) were removed when those charts moved to
   * the shared 320px CHART_PLOT_HEIGHT — a 320px SVG inside a 128px fixed body
   * spilled out over the tiles below it. Kept as API because it is the only
   * way a future tile can reserve height before its chart measures itself.
   */
  bodyHeight?: number;
  /** Legend row rendered under the chart body. */
  legend?: ReactNode;
  loadingLabel?: string;
  emptyMessage?: string;
  errorMessage?: string;
  /** Extra classes on the card root — carries the .bento-* grid-area class. */
  className?: string;
  /**
   * P2 (2026-08-15) — optional id on the card root. Added so a tile can be
   * targeted by `aria-controls` from outside it (the mobile progressive-
   * disclosure toggle in App.tsx, which reveals/hides the sleep-stages,
   * recovery-vs-strain and hydration-vs-recovery tiles). Omit it and nothing
   * changes — every other tile still renders with no id, same as before.
   */
  id?: string;
  children?: ReactNode;
}

/**
 * The tile wrapper every bento chart renders in: Card surface + accessible
 * title slot + a body that is either the chart (Phase 4: a real D3 chart,
 * today: placeholder markup) or one of the loading/empty/error states.
 */
export function ChartContainer({
  title,
  subtitle,
  status = 'ready',
  bodyHeight,
  legend,
  loadingLabel,
  emptyMessage,
  errorMessage,
  className,
  id,
  children,
}: ChartContainerProps) {
  const titleId = useId();
  // A fixed placeholder height must not also flex-grow inside the card.
  const bodyStyle: CSSProperties | undefined =
    bodyHeight !== undefined ? { height: bodyHeight, flex: 'none' } : undefined;
  return (
    <Card
      as="article"
      id={id}
      className={className}
      aria-labelledby={titleId}
      aria-busy={status === 'loading' || undefined}
    >
      <h3 id={titleId} className="ui-chart-title">
        {title}
      </h3>
      {subtitle != null && <p className="ui-chart-subtitle">{subtitle}</p>}
      <div className="ui-chart-body" style={bodyStyle}>
        {status === 'ready' && children}
        {status === 'loading' && <LoadingState label={loadingLabel} />}
        {status === 'empty' && <EmptyState message={emptyMessage} />}
        {status === 'error' && <ErrorState message={errorMessage} />}
      </div>
      {legend != null && <div className="ui-chart-legend">{legend}</div>}
    </Card>
  );
}
