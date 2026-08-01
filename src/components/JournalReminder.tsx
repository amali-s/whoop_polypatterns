import type { RefObject } from 'react';
import { Button } from './Button';
import type { ReminderPrompt } from '../lib/reminder';
import './components.css';

export interface JournalReminderProps {
  /** What to render — decided by `reminderDecision` (src/lib/reminder.ts), never
   *  by this component. 'none' renders an empty region (see below). */
  prompt: ReminderPrompt;
  /** Focus target for a clicked notification, owned by `useJournalReminder`. */
  regionRef: RefObject<HTMLDivElement | null>;
  onEnable: () => void;
  onDismiss: () => void;
  onDisable: () => void;
}

/**
 * The daily journal's reminder control (Phase 5.4) — the opt-in, the off switch,
 * and the "your browser is blocking these" line, in the one region a clicked
 * notification focuses.
 *
 * IT DECIDES NOTHING. Which of the four states shows is `reminderDecision`'s
 * answer (pure, unit-tested); adding a condition here would move policy out of
 * the one place it can be tested.
 *
 * ── ACCESSIBILITY (design.md §5.1's shell rules; §5.2's chart contract does not
 * apply — this is a control, not a chart) ───────────────────────────────────
 * - The region is ALWAYS rendered, `aria-live="polite"`, and empty when there is
 *   nothing to say. A live region has to exist BEFORE its content changes to be
 *   announced (the same reason `JournalForm`'s `.journal-status` is always in the
 *   DOM), and the states genuinely do change in place: opting in flips 'opt-in'
 *   to 'on', or to 'blocked' if the browser refuses.
 * - `tabIndex={-1}` makes it a REAL focus target — out of the tab order, but
 *   focusable on demand, which is what lets a clicked notification put a
 *   keyboard or screen-reader user at the journal rather than only scrolling a
 *   sighted one to it.
 * - Every state is distinguished by its WORDS, not by color: the tinted panel is
 *   identical in all three, so nothing is encoded in hue alone. Text is
 *   `--color-text`/`--color-muted` on `--color-bg` (4.81:1), and both actions are
 *   real `<button>`s via `Button` — so they inherit the 44px `::after` hit area
 *   and the shared accent focus ring, unlike the legacy banner's ✕ (§5.1's known
 *   exception, deliberately not copied here).
 */
export function JournalReminder({
  prompt,
  regionRef,
  onEnable,
  onDismiss,
  onDisable,
}: JournalReminderProps) {
  return (
    <div
      className="journal-reminder"
      ref={regionRef}
      tabIndex={-1}
      // Named, because focus lands here from a notification click: an unnamed
      // generic container announces nothing on focus, and "put the user at the
      // journal" has to mean something to a screen-reader user too.
      role="group"
      aria-label="Journal reminders"
      aria-live="polite"
    >
      {prompt === 'opt-in' && (
        <>
          <p className="journal-reminder-text">
            Want a nudge on days you haven’t logged? Your browser will ask for permission when you
            turn this on.
          </p>
          <div className="journal-reminder-actions">
            <Button type="button" size="sm" onClick={onEnable}>
              Remind me when I haven’t logged today
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={onDismiss}>
              Not now
            </Button>
          </div>
        </>
      )}
      {prompt === 'on' && (
        <>
          <p className="journal-reminder-text">
            Reminders are on — while this dashboard is open, you’ll get one notification a day if
            today isn’t logged.
          </p>
          <div className="journal-reminder-actions">
            <Button type="button" size="sm" variant="secondary" onClick={onDisable}>
              Turn reminders off
            </Button>
          </div>
        </>
      )}
      {prompt === 'blocked' && (
        <>
          <p className="journal-reminder-text">
            Your browser is blocking notifications for this site, so reminders can’t be shown. Allow
            them in your browser’s site settings to switch them back on.
          </p>
          <div className="journal-reminder-actions">
            <Button type="button" size="sm" variant="secondary" onClick={onDisable}>
              Dismiss
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
