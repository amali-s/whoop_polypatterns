import { useEffect, useId, useState } from 'react';
import { chartTransitionDuration } from './motion';

// Phase 4.9 — single-value circular progress ring (bento recovery/strain
// tiles). A plain SVG <circle> stroke-dasharray arc, deliberately NOT
// d3-shape/d3.arc: one arc is fully expressible as
// `dashoffset = circumference * (1 - fraction)` and doesn't justify pulling
// d3.arc into the bundle (ROADMAP 4.9's explicit call).
//
// design.md §5.2 compliance:
// - rule 1: role="img" + <title>/<desc> wired via aria-labelledby, same as
//   ChartSvg. The <desc> describes the DATA ("72 percent, green zone…").
// - rule 2: the ring shows exactly one scalar and the <desc> carries it
//   verbatim — that IS the complete text fallback; a one-row hidden table
//   would only double-announce the same number.
// - rule 3: no tooltip/hover marks, so no keyboard-parity surface.
// - rule 4: the centered value is real SVG <text> in --color-text — the arc
//   hue is never the only encoding (and never colors text, §5.1: the zone
//   tokens --color-positive/-warning are fills-only).
// - rule 5: the dashoffset fill-in is gated on prefers-reduced-motion twice —
//   in JS (chartTransitionDuration → duration 0 renders the final state
//   immediately) and in CSS (charts.css kills the transition property).

export interface ProgressRingProps {
  /** Filled share of the ring, 0–1. Clamped defensively; non-finite → 0. */
  fraction: number;
  /** Accessible name (§5.2 rule 1 <title>), e.g. "Recovery". */
  title: string;
  /**
   * One-sentence summary of the data (rule 1 <desc>), e.g.
   * "72 percent, green recovery zone, July 13, 2026." — or an honest
   * "No data yet." when `noData`.
   */
  desc: string;
  /** Centered display value — real text, never color-only (rule 4). */
  valueLabel: string;
  /** Arc color. Fill-safe tokens only — zone hues are non-text-safe (§5.1). */
  progressColor?: string;
  trackColor?: string;
  /** Bare-track state: no arc, muted value, visible "no data yet" caption. */
  noData?: boolean;
  /** Outer square size in px (the SVG is viewBox-scaled, so this is a max). */
  size?: number;
  strokeWidth?: number;
}

export function ProgressRing({
  fraction,
  title,
  desc,
  valueLabel,
  progressColor = 'var(--color-accent)',
  trackColor = 'var(--color-border)',
  noData = false,
  size = 96,
  strokeWidth = 10,
}: ProgressRingProps) {
  const titleId = useId();
  const descId = useId();

  const clamped = noData || !Number.isFinite(fraction) ? 0 : Math.min(1, Math.max(0, fraction));
  const center = size / 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // Entrance fill, gated on reduced motion (§5.2 rule 5) — same pattern as
  // StackedBarChart: with reduced motion `duration` is 0, `entered` starts
  // true, and the final dashoffset renders immediately with no animated step.
  const duration = chartTransitionDuration(600);
  const [entered, setEntered] = useState(duration === 0);
  useEffect(() => {
    if (entered) {
      return;
    }
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [entered]);

  const offset = circumference * (1 - (entered ? clamped : 0));

  return (
    <div className="progress-ring">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
      >
        <title id={titleId}>{title}</title>
        <desc id={descId}>{desc}</desc>
        <circle
          className="progress-ring-track"
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        {clamped > 0 && (
          <circle
            className="progress-ring-progress"
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={progressColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            // Start the arc at 12 o'clock, not 3 o'clock.
            transform={`rotate(-90 ${center} ${center})`}
            style={{
              transition: duration > 0 ? `stroke-dashoffset ${duration}ms ease-out` : undefined,
            }}
          />
        )}
        <text
          className={
            noData ? 'progress-ring-value progress-ring-value-muted' : 'progress-ring-value'
          }
          x={center}
          y={center}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {valueLabel}
        </text>
      </svg>
      {/* aria-hidden: the <desc> above already says "No data yet." — this is
          the sighted-user copy of the same fact, not a second announcement. */}
      {noData && (
        <p className="progress-ring-caption" aria-hidden="true">
          no data yet
        </p>
      )}
    </div>
  );
}
