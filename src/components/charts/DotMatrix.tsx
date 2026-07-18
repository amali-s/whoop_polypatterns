import { useEffect, useId, useState } from 'react';
import { chartTransitionDuration } from './motion';

// Phase 4.10 — single-row dot matrix (bento period-meter tile). Plain SVG
// <circle> dots positioned by index, deliberately NOT d3 scaleBand: a band
// scale over 0..total-1 reduces to `cx = i * slot + slot / 2`, one expression
// that doesn't justify the machinery (the ProgressRing precedent, ROADMAP
// 4.9/4.10). SVG over flex spans so the row carries the same role="img" +
// <title>/<desc> contract as every other chart surface.
//
// design.md §5.2 compliance:
// - rule 1: role="img" + <title>/<desc> wired via aria-labelledby, same as
//   ChartSvg/ProgressRing. The <desc> describes the DATA ("Day 6 of…").
// - rule 2: the row shows exactly one scalar (day of cycle) and the <desc>
//   carries it verbatim — that IS the complete text fallback; a one-row
//   hidden table would only double-announce the same number.
// - rule 3: no tooltip/hover marks, so no keyboard-parity surface.
// - rule 4: the day number is real visible text below the row — the filled
//   hue is never the only encoding.
// - rule 5: the filled dots' entrance fade is gated on prefers-reduced-motion
//   twice — in JS (chartTransitionDuration → duration 0 renders the final
//   state immediately) and in CSS (charts.css kills the transition).

export interface DotMatrixProps {
  /** Number of dots in the row (the denominator). Never exceeded. */
  total: number;
  /** Filled dot count. Clamped defensively to [0, total]; non-finite → 0. */
  filled: number;
  /** Accessible name (§5.2 rule 1 <title>), e.g. "Cycle day". */
  title: string;
  /**
   * One-sentence summary of the data (rule 1 <desc>), e.g.
   * "Day 6 of an estimated 29-day cycle." — or an honest reason when `noData`.
   */
  desc: string;
  /** Visible value under the row — real text, never color-only (rule 4). */
  valueLabel: string;
  /** Bare-track state: no filled dots, muted value, visible caption. */
  noData?: boolean;
  /** Small muted caption under the value (e.g. the noData reason). */
  caption?: string;
  /** Fill-safe tokens only (§5.1). */
  dotColor?: string;
  trackColor?: string;
}

// Fixed logical slot per dot; the viewBox scales to the tile width.
const SLOT = 16;
const RADIUS = 5;

export function DotMatrix({
  total,
  filled,
  title,
  desc,
  valueLabel,
  noData = false,
  caption,
  dotColor = 'var(--color-chart-3)',
  trackColor = 'var(--color-border)',
}: DotMatrixProps) {
  const titleId = useId();
  const descId = useId();

  const dots = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  // Overflow (filled > total) renders a fully filled row — never extra dots,
  // never a negative count; the caller's valueLabel/desc carry the overflow
  // legibly ("Day 31 of an estimated 28-day cycle").
  const clamped =
    noData || !Number.isFinite(filled) ? 0 : Math.min(dots, Math.max(0, Math.floor(filled)));

  // Entrance fade for the filled dots, gated on reduced motion (§5.2 rule 5) —
  // same pattern as ProgressRing: with reduced motion `duration` is 0,
  // `entered` starts true, and the final fill renders immediately.
  const duration = chartTransitionDuration(400);
  const [entered, setEntered] = useState(duration === 0);
  useEffect(() => {
    if (entered) {
      return;
    }
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [entered]);

  return (
    <div className="dot-matrix">
      <svg
        className="dot-matrix-row"
        viewBox={`0 0 ${Math.max(dots, 1) * SLOT} ${SLOT}`}
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
      >
        <title id={titleId}>{title}</title>
        <desc id={descId}>{desc}</desc>
        {Array.from({ length: dots }, (_, i) => (
          <circle
            key={i}
            className="dot-matrix-dot"
            cx={i * SLOT + SLOT / 2}
            cy={SLOT / 2}
            r={RADIUS}
            fill={i < clamped ? dotColor : trackColor}
            style={
              i < clamped
                ? {
                    opacity: entered ? 1 : 0,
                    transition: duration > 0 ? `opacity ${duration}ms ease-out` : undefined,
                  }
                : undefined
            }
          />
        ))}
      </svg>
      <p className={noData ? 'dot-matrix-value dot-matrix-value-muted' : 'dot-matrix-value'}>
        {valueLabel}
      </p>
      {/* aria-hidden: the <desc> above already carries this fact — this is
          the sighted-user copy, not a second announcement (ProgressRing
          caption precedent). */}
      {caption && (
        <p className="dot-matrix-caption" aria-hidden="true">
          {caption}
        </p>
      )}
    </div>
  );
}
