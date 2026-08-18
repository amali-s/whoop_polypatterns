import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { scaleBand } from 'd3-scale';
import { utcFormat } from 'd3-time-format';
import { utcMonth } from 'd3-time';
import { cx } from './cx';
import { shiftDayISO } from '../lib/day';
import { formatDaySpan } from '../lib/range-format';
import './components.css';

/**
 * Phase 4.16 — custom date-range picker. A calendar that lets you pick an
 * arbitrary START date; the range always ENDS today (the roadmap's "end
 * defaults to now"). Composed BESIDE `RangeToggle` in App's toggle row, not as a
 * segment inside it: selecting "custom" opens a popover rather than refetching,
 * a different interaction than the toggle's two preset segments (so folding it
 * into the radiogroup would fight selection-follows-focus). When a custom range
 * is active the toggle shows no preset selected and this trigger carries the
 * active state.
 *
 * ── The grid is D3/SVG, held to RangeToggle's accessibility bar ──────────────
 * Per the 4.16 brief ("a D3/SVG calendar grid, not a native <input type=date>";
 * "use scaleBand … the DotMatrix.tsx pattern"), the calendar is an SVG grid —
 * columns positioned by `scaleBand` over the seven weekday slots, the
 * DotMatrix "SVG carries the role contract" precedent scaled to two dimensions.
 * The WAI-ARIA date-grid pattern is layered on:
 *   - role="grid" on the <svg>, role="row" on the weekday header + each week,
 *     role="columnheader" on the weekday labels, role="gridcell" on each day.
 *   - ROVING TABINDEX: exactly one day cell is tabbable; arrows move day-to-day
 *     (flipping months at the edges), Home/End jump to the week ends, Page
 *     Up/Down jump a month, Enter/Space select. DOM focus follows via a ref.
 *   - Each day's accessible name is its full date ("Saturday, August 9, 2026");
 *     out-of-range days carry aria-disabled and are genuinely unselectable, not
 *     merely greyed (design.md §5.1/§5.2 — never meaning-by-colour-alone).
 *   - Focus ring: a drawn 2px `--color-accent` stroke on the focused cell
 *     (`.drpk-cell:focus`), the same width/colour as the shell's outline
 *     convention. Drawn rather than a CSS `outline` because outline painting on
 *     SVG is unreliable across engines; `:focus` (not `:focus-visible`) so the
 *     match doesn't depend on SVG focus-visible support.
 *   - The open/close transition is gated on prefers-reduced-motion in
 *     components.css (the Tearsheet precedent).
 *
 * VERIFY (flagged, per the brief's "say what to verify"): screen-reader
 * mapping of role="gridcell"/"columnheader" on SVG group elements has less
 * coverage than an HTML <table role=grid>. The control is fully keyboard-
 * operable and every cell is date-labelled; confirm NVDA/VoiceOver grid
 * navigation on prod, and if a reader can't traverse it, the cells can move to
 * HTML <button>s in a CSS grid keeping this same scaleBand geometry.
 *
 * ── The 90-day floor (client half of the belt-and-suspenders) ────────────────
 * `minDay` (today − 89, a 90-day inclusive span = the server's MAX_DAYS) and
 * `today` bound what is selectable: earlier or future days are disabled IN THE
 * GRID, never merely rejected after a click. `/api/daily-series`'s own [1,90]
 * clamp is the redundant fallback, not the first line of defence.
 */
export interface DateRangePickerProps {
  /** The active custom range's START, or null when a preset is active. Drives
   *  the trigger label, the initially-focused cell, and the selected cell. */
  activeStart: string | null;
  /** Latest selectable day — local today; the range's fixed end. */
  today: string;
  /** Earliest selectable day — today − 89 (a 90-day inclusive span). */
  minDay: string;
  /** Commit a custom range of [startDay, today]. The caller derives the day
   *  count and refetches; picking today is the 1-day "Today" case. */
  onSelect: (startDay: string) => void;
  className?: string;
}

const WEEKDAYS = [
  { short: 'Su', long: 'Sunday' },
  { short: 'Mo', long: 'Monday' },
  { short: 'Tu', long: 'Tuesday' },
  { short: 'We', long: 'Wednesday' },
  { short: 'Th', long: 'Thursday' },
  { short: 'Fr', long: 'Friday' },
  { short: 'Sa', long: 'Saturday' },
] as const;

// Logical SVG units — the viewBox scales to the popover width, so these are a
// ratio, not pixels. Square day cells; a header band for the weekday labels.
const CELL = 40;
const HEADER_H = 26;
const GRID_W = CELL * 7;
const CHIP_R = 15; // day chip radius, < CELL/2 for breathing room
const FOCUS_INSET = 3; // drawn focus-ring inset from the cell edge

const cellDateLabel = utcFormat('%A, %B %-d, %Y'); // "Saturday, August 9, 2026"
const monthTitle = utcFormat('%B %Y'); // "August 2026"

/** ISO 'YYYY-MM-DD' → UTC-midnight Date (calendar date, no zone shift). */
function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** Date → ISO 'YYYY-MM-DD'. */
function toISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** First day (ISO) of the month `day` falls in. */
function monthStartISO(day: string): string {
  return toISO(utcMonth.floor(parseDay(day)));
}

/** Days in the month whose first day is `monthFirstISO` — the whole-day gap to
 *  the first of next month (UTC, so DST never makes it 27.96/28.04). */
function daysInMonth(monthFirstISO: string): number {
  const first = parseDay(monthFirstISO);
  const nextFirst = utcMonth.offset(first, 1);
  return Math.round((nextFirst.getTime() - first.getTime()) / 86_400_000);
}

export function DateRangePicker({
  activeStart,
  today,
  minDay,
  onSelect,
  className,
}: DateRangePickerProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const cellRefs = useRef<Map<string, SVGGElement>>(new Map());
  const headingId = useId();
  const monthLabelId = useId();

  const [open, setOpen] = useState(false);
  // The month on screen (its first day) and the day carrying the roving Tab
  // stop. Both initialise on open from the active start (or today) and stay in
  // sync — `focusedDay` is always a day inside `shownMonth`.
  const [shownMonth, setShownMonth] = useState(() => monthStartISO(activeStart ?? today));
  const [focusedDay, setFocusedDay] = useState(() => activeStart ?? today);
  // A focus REQUEST (fresh object each grid move) that the effect below acts on
  // — so month-nav button clicks can move `focusedDay` WITHOUT yanking DOM focus
  // off the button, while arrow keys DO move focus into the grid.
  const [focusRequest, setFocusRequest] = useState<{ day: string } | null>(null);

  /** Clamp a day into the selectable window [minDay, today]. */
  function clampDay(day: string): string {
    if (day < minDay) return minDay;
    if (day > today) return today;
    return day;
  }

  /** Move the roving focus to `day` (clamped), flipping the shown month if the
   *  day lands outside it, and pull DOM focus onto the new cell. */
  function moveFocusTo(day: string): void {
    const clamped = clampDay(day);
    const month = monthStartISO(clamped);
    if (month !== shownMonth) {
      setShownMonth(month);
    }
    setFocusedDay(clamped);
    setFocusRequest({ day: clamped });
  }

  /** Show a different month (prev/next buttons) WITHOUT moving DOM focus —
   *  reconcile the roving day into the new month so it stays a valid Tab stop. */
  function showMonth(monthFirstISO: string): void {
    setShownMonth(monthFirstISO);
    const dom = Number(focusedDay.slice(8, 10));
    const targetDom = Math.min(dom, daysInMonth(monthFirstISO));
    const reconciled = clampDay(
      `${monthFirstISO.slice(0, 7)}-${String(targetDom).padStart(2, '0')}`,
    );
    setFocusedDay(reconciled);
  }

  function openPopover(): void {
    const start = activeStart ?? today;
    setShownMonth(monthStartISO(start));
    setFocusedDay(start);
    setOpen(true);
  }

  // Mirror `open` onto the real <dialog>. showModal() gives the focus trap,
  // Escape-to-close, inert background and top-layer stacking for free (the
  // Tearsheet argument); on open we then pull focus onto the current cell,
  // since showModal's own focus lands on the first button, not the calendar.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
      cellRefs.current.get(focusedDay)?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
    // focusedDay is read once at open time; it is not a dependency (a change to
    // it while open is handled by the focusRequest effect below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Grid-internal moves (arrows/Home/End/Page/Today) set focusRequest; pull DOM
  // focus onto that cell once it has rendered in the (possibly new) month.
  useEffect(() => {
    if (!open || !focusRequest) {
      return;
    }
    cellRefs.current.get(focusRequest.day)?.focus();
  }, [focusRequest, open]);

  function activate(day: string): void {
    if (day < minDay || day > today) {
      return; // disabled day — genuinely unselectable
    }
    onSelect(day);
    setOpen(false);
  }

  function selectToday(): void {
    // The 1-day range. Applied immediately; the popover stays open and focus
    // drops onto today's now-selected cell so a keyboard user lands somewhere
    // sensible and can arrow back to an earlier start if they want (4.16 brief).
    onSelect(today);
    moveFocusTo(today);
  }

  function handleGridKeyDown(event: KeyboardEvent<SVGSVGElement>): void {
    const weekday = parseDay(focusedDay).getUTCDay();
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        moveFocusTo(shiftDayISO(focusedDay, -1));
        break;
      case 'ArrowRight':
        event.preventDefault();
        moveFocusTo(shiftDayISO(focusedDay, 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveFocusTo(shiftDayISO(focusedDay, -7));
        break;
      case 'ArrowDown':
        event.preventDefault();
        moveFocusTo(shiftDayISO(focusedDay, 7));
        break;
      case 'Home':
        event.preventDefault();
        moveFocusTo(shiftDayISO(focusedDay, -weekday));
        break;
      case 'End':
        event.preventDefault();
        moveFocusTo(shiftDayISO(focusedDay, 6 - weekday));
        break;
      case 'PageUp': {
        event.preventDefault();
        const prev = toISO(utcMonth.offset(parseDay(focusedDay), -1));
        moveFocusTo(prev);
        break;
      }
      case 'PageDown': {
        event.preventDefault();
        const next = toISO(utcMonth.offset(parseDay(focusedDay), 1));
        moveFocusTo(next);
        break;
      }
      case 'Enter':
      case ' ':
        event.preventDefault();
        activate(focusedDay);
        break;
      default:
        break;
    }
  }

  // --- Grid geometry (scaleBand over the seven weekday columns) --------------
  const x = scaleBand<number>().domain([0, 1, 2, 3, 4, 5, 6]).range([0, GRID_W]);
  const colCenter = (col: number) => (x(col) ?? 0) + x.bandwidth() / 2;

  const monthFirst = shownMonth;
  const firstWeekday = parseDay(monthFirst).getUTCDay();
  const numDays = daysInMonth(monthFirst);
  const rows = Math.ceil((firstWeekday + numDays) / 7);
  const svgHeight = HEADER_H + rows * CELL;

  const prevDisabled = shownMonth.slice(0, 7) <= minDay.slice(0, 7);
  const nextDisabled = shownMonth.slice(0, 7) >= today.slice(0, 7);

  const triggerLabel = activeStart ? formatDaySpan(activeStart, today) : 'Custom range';

  return (
    <div className={cx('drpk', className)}>
      <button
        type="button"
        className={cx('drpk-trigger', activeStart && 'drpk-trigger-active')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openPopover}
      >
        <span className="drpk-trigger-icon" aria-hidden="true">
          {/* Calendar glyph — decorative; the label carries the meaning. */}▦
        </span>
        {triggerLabel}
      </button>

      <dialog
        ref={dialogRef}
        className="drpk-dialog"
        aria-labelledby={headingId}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialogRef.current) {
            setOpen(false);
          }
        }}
      >
        <div className="drpk-panel">
          <div className="drpk-panel-head">
            <h2 id={headingId} className="drpk-heading">
              Pick a start date
            </h2>
            <button
              type="button"
              className="drpk-close"
              aria-label="Close date picker"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>

          <button type="button" className="drpk-today" onClick={selectToday}>
            Today
          </button>

          <div className="drpk-nav">
            <button
              type="button"
              className="drpk-nav-btn"
              aria-label="Previous month"
              disabled={prevDisabled}
              onClick={() => showMonth(toISO(utcMonth.offset(parseDay(shownMonth), -1)))}
            >
              ‹
            </button>
            {/* aria-live so a month change from the arrows/buttons is announced. */}
            <span id={monthLabelId} className="drpk-month" aria-live="polite">
              {monthTitle(parseDay(shownMonth))}
            </span>
            <button
              type="button"
              className="drpk-nav-btn"
              aria-label="Next month"
              disabled={nextDisabled}
              onClick={() => showMonth(toISO(utcMonth.offset(parseDay(shownMonth), 1)))}
            >
              ›
            </button>
          </div>

          <svg
            className="drpk-grid"
            viewBox={`0 0 ${GRID_W} ${svgHeight}`}
            role="grid"
            aria-labelledby={monthLabelId}
            onKeyDown={handleGridKeyDown}
          >
            <g className="drpk-weekhead" role="row">
              {WEEKDAYS.map((wd, col) => (
                <text
                  key={wd.short}
                  role="columnheader"
                  aria-label={wd.long}
                  aria-colindex={col + 1}
                  x={colCenter(col)}
                  y={HEADER_H / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="drpk-weekhead-label"
                >
                  {wd.short}
                </text>
              ))}
            </g>

            {Array.from({ length: rows }, (_, row) => (
              <g key={row} role="row">
                {Array.from({ length: 7 }, (_, col) => {
                  const dayIndex = row * 7 + col - firstWeekday; // 0-based day-of-month
                  if (dayIndex < 0 || dayIndex >= numDays) {
                    return null; // leading/trailing blank — no cell for adjacent months
                  }
                  const dayISO = `${monthFirst.slice(0, 7)}-${String(dayIndex + 1).padStart(2, '0')}`;
                  const disabled = dayISO < minDay || dayISO > today;
                  const isFocused = dayISO === focusedDay;
                  const isSelected = dayISO === activeStart;
                  const isToday = dayISO === today;
                  const inRange = activeStart != null && dayISO >= activeStart && dayISO <= today;
                  const cx0 = colCenter(col);
                  const cy0 = HEADER_H + row * CELL + CELL / 2;
                  return (
                    <g
                      key={dayISO}
                      ref={(el) => {
                        if (el) {
                          cellRefs.current.set(dayISO, el);
                        } else {
                          cellRefs.current.delete(dayISO);
                        }
                      }}
                      className={cx(
                        'drpk-cell',
                        disabled && 'drpk-cell-disabled',
                        isSelected && 'drpk-cell-selected',
                        !isSelected && inRange && 'drpk-cell-inrange',
                        isToday && 'drpk-cell-today',
                      )}
                      role="gridcell"
                      aria-colindex={col + 1}
                      tabIndex={isFocused ? 0 : -1}
                      aria-label={cellDateLabel(parseDay(dayISO))}
                      aria-disabled={disabled || undefined}
                      aria-selected={isSelected || undefined}
                      aria-current={isToday ? 'date' : undefined}
                      onClick={() => activate(dayISO)}
                    >
                      {/* Transparent hit area = the whole cell, so clicks near a
                          number still land. */}
                      <rect
                        x={x(col) ?? 0}
                        y={HEADER_H + row * CELL}
                        width={x.bandwidth()}
                        height={CELL}
                        fill="transparent"
                      />
                      {(isSelected || inRange || isToday) && (
                        <circle className="drpk-chip" cx={cx0} cy={cy0} r={CHIP_R} />
                      )}
                      <text
                        className="drpk-daynum"
                        x={cx0}
                        y={cy0}
                        textAnchor="middle"
                        dominantBaseline="central"
                      >
                        {dayIndex + 1}
                      </text>
                      <rect
                        className="drpk-focus-ring"
                        x={(x(col) ?? 0) + FOCUS_INSET}
                        y={HEADER_H + row * CELL + FOCUS_INSET}
                        width={x.bandwidth() - FOCUS_INSET * 2}
                        height={CELL - FOCUS_INSET * 2}
                        rx={8}
                        fill="none"
                      />
                    </g>
                  );
                })}
              </g>
            ))}
          </svg>

          <p className="drpk-hint">
            The range ends today. Dates more than 90 days back aren’t available.
          </p>
        </div>
      </dialog>
    </div>
  );
}
