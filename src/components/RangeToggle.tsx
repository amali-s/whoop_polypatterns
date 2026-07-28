import { useRef, type KeyboardEvent } from 'react';
import { cx } from './cx';
import './components.css';

/**
 * Segmented control for the dashboard time-range toggle (Phase 4.14).
 *
 * ACCESSIBILITY (design.md §5.1's shell rules; §5.2's chart contract does NOT
 * apply — this is an interactive control, not a chart, and has no data to
 * expose as a table):
 * - `role="radiogroup"` wrapping native `<button role="radio">` elements with
 *   `aria-checked`. Native buttons keep Space/Enter activation for free; the
 *   ARIA roles are what tell a screen reader "one of N", which a plain row of
 *   buttons would not convey. A `<fieldset>` of real `<input type="radio">`
 *   would also work, but not without fighting the shell's button styling.
 * - ROVING TABINDEX: only the selected option is in the tab order
 *   (`tabIndex 0`); the rest are `-1` and reached with arrow keys. This is the
 *   WAI-ARIA radiogroup pattern — one Tab stop for the whole group, not one
 *   per option — and it is why §5.1's "no custom tabIndex anywhere" note no
 *   longer holds verbatim: it's required by the pattern, not decoration.
 * - SELECTION FOLLOWS FOCUS on arrow keys (the standard radio behavior), so
 *   arrowing is a real choice, not just a cursor move. Home/End jump to the
 *   ends.
 * - Focus ring is the shell's `2px solid var(--color-accent)` — #1173a6, the
 *   ≥4.6:1 indicator §5.1 already holds every control to.
 *
 * Generic over the option value so it isn't hard-wired to day counts; App
 * instantiates it with `RangeDays` (30 | 90).
 */
export interface RangeToggleOption<T extends string | number> {
  value: T;
  label: string;
}

export interface RangeToggleProps<T extends string | number> {
  options: readonly RangeToggleOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group — there is no visible <legend>. */
  label: string;
  className?: string;
}

export function RangeToggle<T extends string | number>({
  options,
  value,
  onChange,
  label,
  className,
}: RangeToggleProps<T>) {
  // Needed to move DOM focus with the selection when arrowing — the roving
  // tabIndex alone changes what's tabbable, not what's focused.
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function select(index: number) {
    const next = options[index];
    if (!next) {
      return;
    }
    onChange(next.value);
    buttonRefs.current[index]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      // Both axes are mapped: the control is a horizontal row, but the
      // radiogroup pattern expects Up/Down to work regardless of orientation.
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        select((index + 1) % options.length);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        select((index - 1 + options.length) % options.length);
        break;
      case 'Home':
        event.preventDefault();
        select(0);
        break;
      case 'End':
        event.preventDefault();
        select(options.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div role="radiogroup" aria-label={label} className={cx('range-toggle', className)}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            ref={(el) => {
              buttonRefs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={cx('range-toggle-option', selected && 'range-toggle-option-selected')}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
