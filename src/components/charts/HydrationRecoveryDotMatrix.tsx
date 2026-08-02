import { useEffect, useMemo, useState } from 'react';
import { utcFormat } from 'd3-time-format';
import { scaleBand } from './scales';
import { useChartDimensions } from './useChartDimensions';
import { ChartSvg } from './ChartSvg';
import { Axis } from './Axis';
import { Tooltip } from './Tooltip';
import { useTooltip } from './useTooltip';
import { ChartDataTable } from './ChartDataTable';
import type { ChartDataColumn } from './ChartDataTable';
// No chartMarkStyle here: this chart's entrance fade lives on the wrapping
// <g class="correlation-dots">, not on the dots, so the dots carry no inline
// `transition` for .chart-mark's hover/focus rules to collide with.
import { chartTransitionDuration } from './motion';
import { RECOVERY_ZONES, recoveryZone } from '../../lib/recovery';
import { HYDRATION_COLORS, hydrationState } from '../../lib/hydration';
import type { DailyMetricPoint } from '../../../api/_lib/transforms';

// Phase 5.5 — the questionnaire-correlation dot matrix design.md §4 reserved
// for "chart 6, revisited once Phase 5 exists". One dot per calendar day in the
// fetched window, pairing ONE self-reported journal field against ONE WHOOP
// metric.
//
// PAIRING: `hydrated` (self-assessed) vs. `recovery_score`. The ROADMAP's own
// 5.5 wording says "self-reported stress vs. recovery"; there is no stress
// field in the shipped question set (see the ROADMAP 5.5 entry). One pairing
// only: a second would need its own honest summary sentence, and two
// half-argued correlations are worse than one argued properly.
//
// WHAT A BOOLEAN COSTS, stated rather than glossed. `hydrated` is a
// self-assessed STATE, not a dose — 5.1 chose `boolean` deliberately, because
// the locked tile label asks how you felt, not how many litres you drank. So
// this chart cannot show a dose-response the way an `alcohol_drinks` pairing
// could: it compares two groups of days and nothing finer, one self-assessment
// per day is a noisy instrument, and "felt hydrated" is plausibly a CONSEQUENCE
// of good recovery as much as a cause of it. The summary sentence is written to
// claim exactly that much and no more.
//
// TWO ORTHOGONAL CHANNELS, one per variable (revised 2026-07-31 at your
// direction — hue now carries HYDRATION, where it previously duplicated the
// recovery zone):
//   - HYDRATION → the dot's COLOR, three states, one per legend entry:
//     hydrated / dehydrated / undetermined. Reinforced by RADIUS and, for
//     undetermined, a dashed outline — so the answer is never conveyed by hue
//     alone (design.md §5.2 rule 4).
//   - RECOVERY → the dot's ROW: a band per zone, plus a dedicated bottom "no
//     data" row. Position is the encoding and the left axis labels each row in
//     real text ("67–100%"), which is rule 4's "position … or direct
//     labeling" satisfied without hue.
// Nothing is double-encoded across variables any more, which is what makes the
// chart readable as a correlation: hue answers "what did I log?", height
// answers "how did I recover?", and the question is whether the two line up.
//
// NULL DISCIPLINE, the reason for the "no data" vocabulary. The two nulls are
// independent and now live on independent channels, so each stays legible on
// its own:
//   - recovery null (unsynced / PENDING_SCORE / UNSCORABLE day) → the dot moves
//     to the bottom "no data" ROW, keeping whatever hydration color it earned.
//     It is never dropped and never zero-filled.
//   - hydration null (journal never answered that day) → the UNDETERMINED
//     color plus a dashed outline and a mid radius. Deliberately NOT the same
//     mark as an answered `false`: "I logged that I wasn't hydrated" and "I
//     never said" are different facts (5.1), and the one bug worth designing
//     against here is a chart that quietly counts unanswered days as
//     unhydrated ones. The mid radius is deliberate too — size must not imply
//     which answer it WOULD have been, so it sits between the two answers
//     rather than beside either.
//   - Both null → an undetermined-colored dashed dot in the "no data" row.
//
// COLORS (design.md §1, checked before choosing): NO new colors, all three are
// existing tokens.
//   - Hydrated = `--color-chart-1` (light blue — water). §1 maps chart-1 to
//     "Sleep"; sleep does not appear in this chart, which is exactly the
//     per-chart double-duty §1 already sanctions for chart-3 (skin temp vs.
//     the period meter). 1.55:1, so it depends on the shared hairline below.
//   - Dehydrated = `--color-chart-2` (dark orange — dry/warm). §1 maps chart-2
//     to "Calories", likewise absent here. Blue-vs-orange is also the standard
//     colorblind-safe opposition, which matters more here than anywhere else
//     on the dashboard because these two ARE the comparison.
//   - Undetermined = `--color-border`, deliberately NOT a data hue: an
//     unanswered day is an absence, and giving it a saturated color of its own
//     would make "I didn't say" look like a third kind of answer.
// The recovery zone tokens (`--color-positive`/`-warning`/`-negative`) are no
// longer used here at all — hue belongs to hydration now — but the ZONE
// CUTOFFS still come from `src/lib/recovery.ts`, so the rows this chart sorts
// into remain the same 67/34 boundaries the recovery donut uses.
// Every dot wears the `--color-muted` hairline the legend swatches and
// stacked-bar segments wear (rule 4), which is what carries chart-1 and
// --color-border past the 3:1 non-text threshold on the white card.
//
// §5.2 compliance: role="img" + data-describing <title>/<desc> via ChartSvg
// (rule 1); sr-only ChartDataTable of day / hydration / recovery from the SAME
// rows the dots are drawn from (rule 2); every dot is focusable with the
// identical tooltip on hover and focus, Escape dismisses (rule 3); two
// non-hue encodings plus a real-text summary sentence (rule 4); the entrance
// fade is gated on prefers-reduced-motion in JS (chartTransitionDuration) and
// again in CSS (charts.css) (rule 5).

export interface HydrationRecoveryDotMatrixProps {
  /** One point per calendar day, ascending (buildDailySeries output). Dots, summary and data table all derive from this same prop. */
  data: readonly DailyMetricPoint[];
  /** Accessible chart name (design.md §5.2 rule 1). */
  title: string;
  /** Caption for the visually-hidden data table (rule 2). */
  tableCaption: string;
}

/** Every dot's outline: ≥3:1 against the white card whatever it fills (§5.2 rule 4). */
const DOT_STROKE = 'var(--color-muted)';

/** Dash pattern marking "hydration not answered" — a non-hue channel on top of the color. */
const UNANSWERED_DASH = '2 2';

/** Row height per zone band. Four rows (three zones + "no data"). */
const ROW_HEIGHT = 30;

/**
 * The three hydration marks, at full size. A boolean has no scale to map, so
 * these are three fixed radii rather than a continuous ramp: `true` is the
 * largest, `false` the smallest (a 4× area difference — readable at a glance
 * without a legend lookup), and the unanswered dot sits BETWEEN them precisely
 * because size must not imply which answer it would have been. Size REPEATS
 * what the color says: it is the non-hue channel rule 4 requires, so the chart
 * survives being read in greyscale or by a colorblind reader.
 */
const R_HYDRATED = 7;
const R_NOT_HYDRATED = 3.5;
const R_UNANSWERED = 5;

/**
 * Floor on the responsive shrink below (see `fit`). Under ~0.57 the smallest
 * dot drops below 2px and stops reading as a mark at all; better to let the
 * biggest dots touch their neighbours than to render dust.
 */
const MIN_FIT = 0.57;

/**
 * Days needed in EACH group before the headline comparison is shown. Below it
 * the summary says how many days each group has instead of naming an average —
 * a "12% lower when not hydrated" computed off one bad Saturday sounds like
 * evidence and isn't. Deliberately looser than 4.12's BASELINE_MIN_SAMPLES =
 * 10: that floor guards a headline metric shown ALONE, whereas this sentence is
 * printed beside all N dots and always states its own day counts, so the reader
 * can weigh it. Still a judgement call, not a statistical test — this chart
 * never claims significance.
 */
const MIN_DAYS_PER_GROUP = 3;

const MARGIN = { top: 10, right: 12, bottom: 28, left: 64 };

const shortDay = utcFormat('%b %-d');
const longDay = utcFormat('%B %-d, %Y');

/** Format a YYYY-MM-DD day via a UTC formatter (no local-zone day shift). Mirrors the combo charts'. */
function formatDay(day: string, formatter: (d: Date) => string): string {
  const date = new Date(day);
  return Number.isNaN(date.getTime()) ? day : formatter(date);
}

/** Recovery to a whole percent — the precision WHOOP itself surfaces. */
function formatRecovery(value: number): string {
  return `${Math.round(value)}%`;
}

/** Row key: the zone a score falls in, or the dedicated no-recovery row. */
type MatrixRow = string;
const NO_RECOVERY_ROW: MatrixRow = 'no-recovery';

/**
 * Row labels for the left axis, DERIVED from RECOVERY_ZONES rather than typed
 * out: a zone's upper bound is the next-higher zone's `min - 1` (green being
 * capped at 100), so the labels can never drift from the cutoffs the dots are
 * actually sorted by. Reproduces whoop-101 verbatim: 67–100 / 34–66 / 0–33.
 */
function zoneRangeLabel(index: number): string {
  const zone = RECOVERY_ZONES[index];
  const upper = index === 0 ? 100 : RECOVERY_ZONES[index - 1].min - 1;
  return `${zone.min}–${upper}%`;
}

const ROW_ORDER: MatrixRow[] = [...RECOVERY_ZONES.map((z) => z.name), NO_RECOVERY_ROW];

const ROW_LABELS: Record<MatrixRow, string> = {
  ...Object.fromEntries(RECOVERY_ZONES.map((z, i) => [z.name, zoneRangeLabel(i)])),
  [NO_RECOVERY_ROW]: 'no data',
};

/** One day's pairing — the row the dots, tooltip, summary and table all read. */
interface HydrationRecoveryDatum {
  day: string;
  /** WHOOP recovery percent (DailyMetricPoint.recoveryScore); null = unscored/missing. */
  recoveryScore: number | null;
  /** Self-assessed hydration; `false` = answered no, null = NOT ANSWERED. */
  hydrated: boolean | null;
  /** Zone name, or NO_RECOVERY_ROW when there is no score to place. Drives POSITION only. */
  row: MatrixRow;
  /** One of HYDRATION_COLORS — a function of `hydrated` ALONE, never of recovery. */
  fill: string;
}

/**
 * The hydration color for a day's answer — the chart's only use of hue. Both
 * the state mapping and the palette come from `src/lib/hydration.ts`, the same
 * module App's legend swatches read, so a dot and its legend entry cannot
 * disagree about what a color means.
 */
function hydrationFill(hydrated: boolean | null): string {
  return HYDRATION_COLORS[hydrationState(hydrated)];
}

/** The two-group comparison the chart exists to make. Counts are always reported alongside. */
interface CorrelationSummary {
  /** Days answered hydrated AND carrying a recovery score. */
  hydratedDays: number;
  /** Days answered NOT hydrated AND carrying a recovery score. */
  notHydratedDays: number;
  /** Mean recovery over each group; null when that group is empty. */
  hydratedMean: number | null;
  notHydratedMean: number | null;
  /** Days whose hydration question was never answered (whatever their recovery). */
  unanswered: number;
  /** Days with no recovery score (whatever their hydration answer). */
  missingRecovery: number;
  total: number;
}

function summarize(rows: readonly HydrationRecoveryDatum[]): CorrelationSummary {
  const yes: number[] = [];
  const no: number[] = [];
  let unanswered = 0;
  let missingRecovery = 0;
  for (const row of rows) {
    // `== null` and not `!row.hydrated`: an answered `false` is an ANSWER, and
    // truthiness checking is exactly how it would get miscounted as unanswered.
    if (row.hydrated == null) {
      unanswered += 1;
    }
    if (row.recoveryScore == null) {
      missingRecovery += 1;
    }
    // A day joins a group only when BOTH facts exist — an unanswered day is
    // never counted as "not hydrated", and a day with no recovery score
    // contributes no recovery number to either mean.
    if (row.hydrated == null || row.recoveryScore == null) {
      continue;
    }
    (row.hydrated ? yes : no).push(row.recoveryScore);
  }
  const mean = (values: number[]) =>
    values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
  return {
    hydratedDays: yes.length,
    notHydratedDays: no.length,
    hydratedMean: mean(yes),
    notHydratedMean: mean(no),
    unanswered,
    missingRecovery,
    total: rows.length,
  };
}

/**
 * The headline sentence. ONE authored string, rendered visibly AND folded into
 * the SVG <desc>, so the two surfaces cannot drift apart. Never asserts cause,
 * and deliberately doesn't even assert a direction: with a self-assessed
 * boolean, feeling hydrated is as plausibly a CONSEQUENCE of a good recovery as
 * a cause of one, so the copy reports the two averages and stops.
 */
function summarySentence(s: CorrelationSummary): string {
  if (s.hydratedDays >= MIN_DAYS_PER_GROUP && s.notHydratedDays >= MIN_DAYS_PER_GROUP) {
    const yes = formatRecovery(s.hydratedMean ?? 0);
    const no = formatRecovery(s.notHydratedMean ?? 0);
    return `Recovery averaged ${yes} on the ${s.hydratedDays} days you logged as hydrated and ${no} on the ${s.notHydratedDays} days you didn't — an association in your own log, not proof that either one causes the other.`;
  }
  if (s.hydratedDays === 0 && s.notHydratedDays === 0) {
    return 'No day yet has both a hydration answer and a recovery score, so there is nothing to compare — log hydration in the daily journal to build the comparison.';
  }
  return `Not enough logged days to compare yet: ${s.hydratedDays} logged as hydrated, ${s.notHydratedDays} as not (${MIN_DAYS_PER_GROUP} of each needed).`;
}

/** Coverage line — how much of the window is actually answered/scored. */
function coverageSentence(s: CorrelationSummary): string {
  return `${s.unanswered} of ${s.total} days have no hydration answer; ${s.missingRecovery} have no recovery score.`;
}

/** Spoken/written description of a day's hydration answer — one source for aria-label, tooltip and table. */
function describeHydration(hydrated: boolean | null): string {
  if (hydrated == null) {
    return 'hydration not logged';
  }
  return hydrated ? 'logged as hydrated' : 'logged as not hydrated';
}

export function HydrationRecoveryDotMatrix({
  data,
  title,
  tableCaption,
}: HydrationRecoveryDotMatrixProps) {
  // Height is pinned to the four fixed rows, so the aspect ratio passed here is
  // inert and only boundedWidth is used (the Sparkline / 4.3 / 4.15 precedent).
  const [wrapperRef, dims] = useChartDimensions(MARGIN, 0.3);
  const boundedHeight = ROW_ORDER.length * ROW_HEIGHT;
  const plotHeight = boundedHeight + MARGIN.top + MARGIN.bottom;
  const { tooltip, visible, show, hide, onKeyDown } = useTooltip<HydrationRecoveryDatum>();

  // Entrance fade, gated on reduced motion (§5.2 rule 5) — same pattern as
  // every other chart: with reduced motion `duration` is 0, `entered` starts
  // true, and the final state renders immediately.
  const duration = chartTransitionDuration(400);
  const [entered, setEntered] = useState(duration === 0);
  useEffect(() => {
    if (entered) {
      return;
    }
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [entered]);

  const rows = useMemo<HydrationRecoveryDatum[]>(
    () =>
      data.map((p) => {
        // The zone decides only WHICH ROW the dot sits in; its `color` is
        // deliberately unused here, because hue belongs to hydration now.
        const zone = p.recoveryScore == null ? null : recoveryZone(p.recoveryScore);
        return {
          day: p.day,
          recoveryScore: p.recoveryScore,
          hydrated: p.hydrated,
          row: zone ? zone.name : NO_RECOVERY_ROW,
          fill: hydrationFill(p.hydrated),
        };
      }),
    [data],
  );

  const days = useMemo(() => rows.map((r) => r.day), [rows]);
  const summary = useMemo(() => summarize(rows), [rows]);

  // Band scale over day strings (the 4.1–4.3 rationale): every day keeps its
  // own slot whether or not it carries data, so a gap occupies real width, and
  // UTC day strings never round-trip through local-time Date ticks.
  const xScale = useMemo(
    () => scaleBand<string>().domain(days).range([0, dims.boundedWidth]),
    [days, dims.boundedWidth],
  );

  const yScale = useMemo(
    () => scaleBand<MatrixRow>().domain(ROW_ORDER).range([0, boundedHeight]),
    [boundedHeight],
  );

  /**
   * Uniform shrink factor so 90 days (or a 375px phone) packs tighter instead
   * of colliding. Scaling all three radii by ONE factor is what keeps the
   * encoding intact — the hydrated/not-hydrated size RATIO is the signal, and
   * clamping each radius independently would flatten it exactly where columns
   * are narrowest.
   *
   * The column factor is 0.6, NOT 0.5: at half a bandwidth the size channel
   * nearly vanishes on a narrow viewport. At 0.6 the biggest dots can nudge
   * into the neighbouring column — accepted deliberately, because the rows keep
   * the dots separated vertically and an encoding you can't see is worse than
   * one that touches. The exact answers are in the tooltip, the aria-label and
   * the table either way.
   */
  const fit = useMemo(() => {
    const byColumn = (xScale.bandwidth() * 0.6) / R_HYDRATED;
    const byRow = (ROW_HEIGHT / 2 - 2) / R_HYDRATED;
    return Math.max(MIN_FIT, Math.min(1, byColumn, byRow));
  }, [xScale]);

  /** Radius for a day's hydration answer, at the current fit. */
  const radiusFor = useMemo(() => {
    return (hydrated: boolean | null) => {
      if (hydrated == null) {
        return R_UNANSWERED * fit;
      }
      return (hydrated ? R_HYDRATED : R_NOT_HYDRATED) * fit;
    };
  }, [fit]);

  // Rule 1 — a <desc> about the DATA, carrying the same comparison the visible
  // summary shows plus the window and the coverage caveat.
  const desc = useMemo(() => {
    if (rows.length === 0) {
      return 'No data.';
    }
    const first = formatDay(days[0], longDay);
    const last = formatDay(days[days.length - 1], longDay);
    return `Self-reported hydration against WHOOP recovery, one dot per day from ${first} to ${last}. ${summarySentence(summary)} ${coverageSentence(summary)}`;
  }, [rows, days, summary]);

  // ~7 bottom ticks, evenly thinned — the compact-tile tick density 4.3/4.15 use.
  const tickValues = useMemo(() => {
    const step = Math.max(1, Math.ceil(days.length / 7));
    return days.filter((_, i) => i % step === 0);
  }, [days]);

  // Rule 2 — the table renders from the SAME rows the dots are drawn from.
  // Hydration is mapped to the STRINGS 'Yes'/'No', never handed over as a raw
  // boolean: `false` would render as an empty cell in JSX, which is precisely
  // how an answered "no" would silently become indistinguishable from a gap.
  // Only a genuine null returns null, so only a genuine null reads "no data".
  const tableColumns = useMemo<ChartDataColumn<HydrationRecoveryDatum>[]>(
    () => [
      { key: 'day', header: 'Day', value: (row) => formatDay(row.day, longDay) },
      {
        key: 'hydrated',
        header: 'Hydrated',
        value: (row) => (row.hydrated == null ? null : row.hydrated ? 'Yes' : 'No'),
      },
      {
        key: 'recovery',
        header: 'Recovery',
        value: (row) => (row.recoveryScore == null ? null : formatRecovery(row.recoveryScore)),
      },
    ],
    [],
  );

  const fadeStyle = {
    opacity: entered ? 1 : 0,
    transition: duration > 0 ? `opacity ${duration}ms ease-out` : undefined,
  };

  // The zone is named by its RANGE ("67–100%"), not by WHOOP's hue name
  // ("green zone", which the recovery donut still uses): on this chart the hues
  // mean hydration, so announcing a colour word for a recovery band would
  // contradict what the dot actually looks like. The range is also exactly what
  // the left axis prints, so what is heard matches what is seen.
  function describeRecovery(row: HydrationRecoveryDatum): string {
    return row.recoveryScore == null
      ? 'no recovery score'
      : `recovery ${formatRecovery(row.recoveryScore)}, ${ROW_LABELS[row.row]} band`;
  }

  return (
    <div className="chart-wrapper" ref={wrapperRef}>
      {dims.width > 0 && (
        <ChartSvg width={dims.width} height={plotHeight} title={title} desc={desc}>
          <g transform={`translate(${dims.margin.left}, ${dims.margin.top})`}>
            {/* Row labels are the zone RANGES ("67–100%"), not the hue names —
                the axis must be readable without reference to color. */}
            <Axis
              scale={yScale}
              orientation="left"
              length={boundedHeight}
              format={(value) => ROW_LABELS[String(value)] ?? String(value)}
            />
            <g transform={`translate(0, ${boundedHeight})`}>
              <Axis
                scale={xScale}
                orientation="bottom"
                length={dims.boundedWidth}
                tickValues={tickValues}
                format={(value) => formatDay(String(value), shortDay)}
              />
            </g>
            {/* Row separators — decorative only (the left axis already labels
                every row in real text), so they stay out of the a11y tree. */}
            <g aria-hidden="true">
              {ROW_ORDER.map((row) => (
                <line
                  key={row}
                  className="correlation-rowline"
                  x1={0}
                  x2={dims.boundedWidth}
                  y1={(yScale(row) ?? 0) + yScale.bandwidth()}
                  y2={(yScale(row) ?? 0) + yScale.bandwidth()}
                />
              ))}
            </g>
            <g className="correlation-dots" style={fadeStyle}>
              {rows.map((row) => {
                const bandX = xScale(row.day);
                const bandY = yScale(row.row);
                if (bandX === undefined || bandY === undefined) {
                  return null;
                }
                const cx = bandX + xScale.bandwidth() / 2;
                const cy = bandY + yScale.bandwidth() / 2;
                const answered = row.hydrated != null;
                return (
                  <circle
                    key={row.day}
                    className="chart-mark correlation-dot"
                    cx={cx}
                    cy={cy}
                    r={radiusFor(row.hydrated)}
                    // Always filled — an unanswered day gets the UNDETERMINED
                    // color rather than no color, and wears the dash on top as
                    // the non-hue half of that signal.
                    fill={row.fill}
                    stroke={DOT_STROKE}
                    strokeWidth={1}
                    strokeDasharray={answered ? undefined : UNANSWERED_DASH}
                    tabIndex={0}
                    role="img"
                    aria-label={`${formatDay(row.day, longDay)}: ${describeRecovery(row)}, ${describeHydration(row.hydrated)}.`}
                    onMouseEnter={() => show(row, dims.margin.left + cx, dims.margin.top + cy)}
                    onMouseLeave={hide}
                    onFocus={() => show(row, dims.margin.left + cx, dims.margin.top + cy)}
                    onBlur={hide}
                    onKeyDown={onKeyDown}
                  />
                );
              })}
            </g>
          </g>
        </ChartSvg>
      )}
      {/* Identical content on hover and focus (rule 3) — one show() path. */}
      {tooltip && (
        <Tooltip x={tooltip.x} y={tooltip.y} visible={visible}>
          <strong>{formatDay(tooltip.datum.day, longDay)}</strong>
          <div>
            Recovery:{' '}
            {tooltip.datum.recoveryScore != null
              ? `${formatRecovery(tooltip.datum.recoveryScore)} (${ROW_LABELS[tooltip.datum.row]})`
              : 'no data'}
          </div>
          <div>
            Hydrated:{' '}
            {tooltip.datum.hydrated == null ? 'not logged' : tooltip.datum.hydrated ? 'yes' : 'no'}
          </div>
        </Tooltip>
      )}
      {/* Real visible text, never color-only (rule 4). aria-hidden because the
          <desc> above already carries these exact sentences — same authored
          strings, so this is the sighted-user copy, not a second announcement
          (the DotMatrix / ProgressRing caption precedent). */}
      <p className="correlation-summary" aria-hidden="true">
        {summarySentence(summary)}
      </p>
      <p className="correlation-caption" aria-hidden="true">
        {coverageSentence(summary)}
      </p>
      <ChartDataTable
        caption={tableCaption}
        rowKey={(d) => d.day}
        rows={rows}
        columns={tableColumns}
      />
    </div>
  );
}
