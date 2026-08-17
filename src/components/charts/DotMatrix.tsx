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
  /**
   * Number of dots in the row (the denominator). Never exceeded.
   *
   * Under `openEnded` this is NOT a denominator — see that prop.
   */
  total: number;
  /** Filled dot count. Clamped defensively to [0, total]; non-finite → 0. */
  filled: number;
  /**
   * COUNT MODE: draw the filled dots and nothing else — no track behind them,
   * so no denominator is drawn or implied. For the day-only cycle state, where
   * a day number is known but a cycle length genuinely is not (the 2026-07-18
   * "never assume 28" decision): "day 3" renders as 3 pills and blank space,
   * which claims a count and not a proportion.
   *
   * `total` then means the row's RESERVED WIDTH in slots, not a claim about
   * anything. It exists only so a 3-dot row draws dots the same physical size
   * as a 29-dot one — the viewBox scales to the tile, so sizing to the filled
   * count alone would balloon three dots across the whole tile. The row GROWS
   * past that reservation rather than capping the count, exactly as a long
   * cycle length does in normal mode.
   *
   * Callers must keep `valueLabel`/`desc` free of any denominator here; there
   * is nothing to be "of".
   */
  openEnded?: boolean;
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
  /**
   * Per-dot appearance, index-aligned to the row. When given it REPLACES the
   * filled/track fill rule entirely — each dot's fill comes from here, so a
   * dot can encode what its day MEANS rather than just whether it has passed
   * (the period meter colours by the journal's logged answer; see
   * src/lib/period-dots.ts, which owns that mapping).
   *
   * `outlined` draws the `--color-muted` hairline every low-contrast fill on
   * this dashboard needs to clear 3:1 (§5.2 rule 4), and `dashed` makes that
   * outline a non-hue channel of its own. Shorter than the row → the remaining
   * dots fall back to the default rule; longer → the extras are ignored.
   */
  dotStyles?: readonly { fill: string; outlined?: boolean; dashed?: boolean }[];
  /** Fill-safe tokens only (§5.1). */
  dotColor?: string;
  trackColor?: string;
}

// Fixed logical slot per dot; the viewBox scales to the tile width.
const SLOT = 16;
const RADIUS = 5;

/** Hairline on a `dotStyles` dot: >=3:1 against the white card whatever it
 *  fills (§5.2 rule 4). Same token and role as HydrationRecoveryDotMatrix's. */
const DOT_STROKE = 'var(--color-muted)';

/** Dash pattern for a `dashed` dot — a non-hue channel on top of the colour.
 *  Matches the hydration matrix's "not answered" dots exactly. */
const UNANSWERED_DASH = '2 2';

export function DotMatrix({
  total,
  filled,
  openEnded = false,
  title,
  desc,
  valueLabel,
  noData = false,
  caption,
  dotStyles,
  dotColor = 'var(--color-chart-3)',
  trackColor = 'var(--color-border)',
}: DotMatrixProps) {
  const titleId = useId();
  const descId = useId();

  const slots = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const requested = noData || !Number.isFinite(filled) ? 0 : Math.max(0, Math.floor(filled));
  // Normal mode: the row IS `total` dots. Open-ended: `total` is only a
  // reserved width, so the row grows to fit a count that outruns it (day 31 of
  // an unknown-length cycle must draw 31 dots — there is no denominator to cap
  // against, and capping would silently under-report the day).
  const dots = openEnded ? Math.max(slots, requested) : slots;
  // Overflow (filled > total) renders a fully filled row — never extra dots,
  // never a negative count; the caller's valueLabel/desc carry the overflow
  // legibly ("Day 31 of an estimated 28-day cycle"). Unreachable when
  // openEnded, since `dots` already grew to cover it.
  const clamped = Math.min(dots, requested);

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
        // Left-align the row instead of the SVG default (`xMidYMid meet`,
        // which centers the viewBox horizontally whenever the rendered box's
        // aspect ratio doesn't exactly match the viewBox's — e.g. `openEnded`
        // mode, where the viewBox reserves a fixed CYCLE_ROW_SLOTS width but
        // only the first few dots are drawn). `xMin` pins the scaled content
        // to the left edge of the box, matching `.dot-matrix`'s own
        // `align-items: flex-start` and the "left aligned, not centered"
        // requirement (2026-08-17).
        preserveAspectRatio="xMinYMid meet"
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
      >
        <title id={titleId}>{title}</title>
        <desc id={descId}>{desc}</desc>
        {Array.from({ length: dots }, (_, i) => {
          const isFilled = i < clamped;
          // Open-ended draws NO track: an unfilled dot is what makes a row read
          // as "n of something", and there is no something here.
          if (openEnded && !isFilled) {
            return null;
          }
          const style = dotStyles?.[i];
          return (
            <circle
              key={i}
              className="dot-matrix-dot"
              cx={i * SLOT + SLOT / 2}
              cy={SLOT / 2}
              r={RADIUS}
              fill={style ? style.fill : isFilled ? dotColor : trackColor}
              stroke={style?.outlined ? DOT_STROKE : undefined}
              strokeWidth={style?.outlined ? 1 : undefined}
              strokeDasharray={style?.dashed ? UNANSWERED_DASH : undefined}
              style={
                isFilled
                  ? {
                      opacity: entered ? 1 : 0,
                      transition: duration > 0 ? `opacity ${duration}ms ease-out` : undefined,
                    }
                  : undefined
              }
            />
          );
        })}
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
