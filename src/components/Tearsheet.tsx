import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cx } from './cx';
import './components.css';

/**
 * Bottom-anchored tearsheet (2026-08-01) — a panel that slides up from the
 * bottom edge over the dashboard, holding a task the tile beneath it is too
 * small for. Built for the daily journal; nothing about it is journal-specific.
 *
 * SCOPE OF THE BORROW: the interaction pattern (slide-up-from-bottom, modal
 * over the page, explicit open/close) comes from the referenced design-system
 * tearsheet. NONE of its visuals do — the surface is this app's own §1 tokens
 * (`--color-surface`, `--radius-xl`, `--shadow-card`, the inset gloss), so a
 * tearsheet looks like the rest of the Aero shell, not like another product.
 *
 * WHY NATIVE `<dialog>` rather than a hand-rolled overlay: `showModal()` gives
 * the focus trap, the inert background, the top-layer stacking (so nothing in
 * the bento grid can paint over it) and Escape-to-close for free. Every one of
 * those is a thing a `role="dialog"` div has to reimplement, usually badly.
 *
 * ANIMATION: transform + opacity, with `transition-behavior: allow-discrete`
 * and `@starting-style` in components.css so the panel animates BOTH ways
 * (`display` is discrete, so without those it would only ever animate out).
 * Where those aren't supported the panel simply appears and disappears — a
 * graceful degradation, not a broken state. Gated on prefers-reduced-motion.
 */
export interface TearsheetProps {
  /** Caller owns the open state; this component only mirrors it onto the dialog. */
  open: boolean;
  /** Visible heading, and the dialog's accessible name. */
  title: string;
  /**
   * Called for EVERY dismissal — the ✕, Escape, and a backdrop click. The
   * caller must treat all three the same way, since a user cannot tell them
   * apart. For the journal that means "discard in-progress input".
   */
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

export function Tearsheet({ open, title, onClose, children, className }: TearsheetProps) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  // Mirror `open` onto the real dialog. Guarded both ways: showModal() on an
  // already-open dialog throws, and close() on a closed one fires a spurious
  // 'close' event that would bounce straight back into onClose.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={cx('tearsheet', className)}
      aria-labelledby={titleId}
      // Fires on Escape and on close(); the guard above means a programmatic
      // close (open flipped to false) can't re-enter onClose in a loop.
      onClose={onClose}
      // The dialog element fills the viewport in the top layer, so a click that
      // lands on the element itself — rather than on .tearsheet-panel inside it
      // — is a click on the backdrop.
      onClick={(event) => {
        if (event.target === ref.current) {
          onClose();
        }
      }}
    >
      <div className="tearsheet-panel">
        <div className="tearsheet-head">
          {/* Grab handle: the affordance that says "this came up from the
              bottom and can go back down". Purely decorative. */}
          <span className="tearsheet-grip" aria-hidden="true" />
          <h2 id={titleId} className="tearsheet-title">
            {title}
          </h2>
          <button
            type="button"
            className="tearsheet-close"
            aria-label={`Close ${title}`}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="tearsheet-body">{children}</div>
      </div>
    </dialog>
  );
}
