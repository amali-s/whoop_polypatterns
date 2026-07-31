import type { ComponentPropsWithRef, LabelHTMLAttributes, SelectHTMLAttributes } from 'react';
import { cx } from './cx';
import './components.css';

/**
 * Base form primitives on the §1 tokens (task 3.3). Their first consumer is
 * `JournalForm` (Phase 5.2). Deliberately minimal: no validation, no field
 * wrappers — the questionnaire owns its own error text and fieldset layout.
 *
 * `Input`/`Textarea` are typed with `ComponentPropsWithRef` rather than the
 * bare `*HTMLAttributes` (5.2) so a caller can hold a ref — the journal form
 * moves focus to the first invalid count field on a failed submit. React 19
 * passes `ref` as an ordinary prop, so no `forwardRef` is involved; only the
 * prop type needed widening. `Label`/`Select` keep their 3.3 signatures —
 * nothing needs a ref to them yet.
 */

export function Label({ className, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cx('ui-label', className)} {...rest} />;
}

export function Input({ className, ...rest }: ComponentPropsWithRef<'input'>) {
  return <input className={cx('ui-input', className)} {...rest} />;
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx('ui-select', className)} {...rest} />;
}

/** Multi-line sibling of `Input` — the journal's free-text `notes` field. */
export function Textarea({ className, ...rest }: ComponentPropsWithRef<'textarea'>) {
  return <textarea className={cx('ui-input', 'ui-textarea', className)} {...rest} />;
}
