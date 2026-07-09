import type { InputHTMLAttributes, LabelHTMLAttributes, SelectHTMLAttributes } from 'react';
import { cx } from './cx';
import './components.css';

/**
 * Base form primitives on the §1 tokens (task 3.3). Nothing consumes these
 * yet — the Phase 5 questionnaire will. Deliberately minimal (one label, one
 * text input, one select): no validation, no field wrappers, no spec exists.
 */

export function Label({ className, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cx('ui-label', className)} {...rest} />;
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx('ui-input', className)} {...rest} />;
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx('ui-select', className)} {...rest} />;
}
