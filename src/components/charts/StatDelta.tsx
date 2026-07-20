import type { BaselineDelta } from '../../lib/stats';

// Phase 4.12 — headline stat + trailing-average delta (bento Calories & Sleep
// tiles). One reusable presentational component; the two tiles differ ONLY in
// the formatters and captions they inject. All metric-specific math (kJ→kcal,
// millis→minutes) lives in the caller — this component just renders what it is
// handed.
//
// design.md §5.2, mapped DELIBERATELY (this is NOT an SVG chart, so most rules
// are n/a — stated here so a reader doesn't wonder, the Sparkline precedent):
// - rules 1–3 (SVG role/title/desc, sr-only data-table fallback, keyboard
//   tooltip parity) are N/A: there is no SVG and no hover surface. The value
//   and the delta are real, visible DOM text — strictly BETTER than a hidden
//   fallback table, so there is nothing to duplicate into the a11y tree.
// - rule 4 is the LIVE one: the delta is NEVER encoded by color or by a bare
//   glyph alone. It is a real text sentence ("312 cal above your recent
//   average"); the ▲/▼ is decorative and `aria-hidden`. We deliberately do NOT
//   use --color-positive / --color-negative — more calories or less sleep is
//   not semantically good or bad, and the recovery rings already spend those
//   tokens on zones. Text is --color-text / --color-muted; chart hues are never
//   text (standing §5.1 rule).
// - rule 5: no animation. A static render is honest and needs no reduced-motion
//   gate (4.9/4.10/4.11 preferred a gated entrance; here there is nothing to
//   gate, which is simpler and just as correct).
//
// NULL DISCIPLINE (ProgressRing/DotMatrix/Sparkline precedent): a missing value
// renders a muted "—" plus a caption naming the REAL reason — never a 0, never
// a fabricated delta. The three BaselineDelta kinds map straight to that:
//   no-value   → "—" + noValueCaption (today's metric is genuinely absent)
//   no-baseline→ the real value + noBaselineCaption, NO delta (too little
//                history to honestly compare — decision 2's floor)
//   full       → the value + the delta sentence

export interface StatDeltaProps {
  /** The comparison to render (from baselineDelta in src/lib/stats.ts). */
  delta: BaselineDelta;
  /** Format today's value for display (e.g. millis → "7:32 hrs", kJ → "2,384 cal"). */
  formatValue: (value: number) => string;
  /**
   * Convert the ABSOLUTE raw delta (the accessor's native unit) to the rounded
   * DISPLAY integer — millis → minutes, kJ → kcal. Used both for the sentence
   * magnitude AND to detect a rounds-to-zero delta ("in line with…"), so the
   * arrow and the value never disagree.
   */
  deltaToDisplay: (absoluteDelta: number) => number;
  /** Unit noun for the delta sentence ("min", "cal"). */
  deltaUnit: string;
  /** Muted caption under the "—" when today has no value — names the real reason. */
  noValueCaption: string;
  /** Muted caption under the value when the baseline is too thin for a delta. */
  noBaselineCaption: string;
}

export function StatDelta({
  delta,
  formatValue,
  deltaToDisplay,
  deltaUnit,
  noValueCaption,
  noBaselineCaption,
}: StatDeltaProps) {
  if (delta.kind === 'no-value') {
    return (
      <div className="stat-delta">
        <p className="stat-delta-value stat-delta-value-muted">—</p>
        <p className="stat-delta-caption">{noValueCaption}</p>
      </div>
    );
  }

  if (delta.kind === 'no-baseline') {
    return (
      <div className="stat-delta">
        <p className="stat-delta-value">{formatValue(delta.value)}</p>
        <p className="stat-delta-caption">{noBaselineCaption}</p>
      </div>
    );
  }

  // kind === 'full'. Direction is taken from the DISPLAYED (rounded) magnitude,
  // not the raw delta, so a sub-unit difference reads "in line" rather than
  // "0 min above" (a contradiction).
  const magnitude = deltaToDisplay(Math.abs(delta.delta));
  const above = delta.delta > 0;
  const arrow = magnitude === 0 ? null : above ? '▲' : '▼';
  const sentence =
    magnitude === 0
      ? 'In line with your recent average'
      : `${magnitude} ${deltaUnit} ${above ? 'above' : 'below'} your recent average`;

  return (
    <div className="stat-delta">
      <p className="stat-delta-value">{formatValue(delta.value)}</p>
      <p className="stat-delta-trend">
        {arrow && (
          <span className="stat-delta-arrow" aria-hidden="true">
            {arrow}{' '}
          </span>
        )}
        {sentence}
      </p>
    </div>
  );
}
