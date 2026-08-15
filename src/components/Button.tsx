import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import './components.css';

interface CommonButtonProps {
  /**
   * 'ghost' (P1, 2026-08-15) — a third, lower-emphasis treatment for actions
   * that must stay reachable but shouldn't compete with the primary one
   * beside them. Introduced for the header's Disconnect action: it and
   * "Sync now" were both rendering as identical secondary pills, which read
   * as two equally-weighted actions when Disconnect is the rarer, more
   * consequential one. No border/surface fill at rest (see .ui-btn-ghost in
   * components.css) — it only picks up a boundary on hover/focus/active.
   */
  variant?: 'primary' | 'secondary' | 'ghost';
  /** 'md' = card CTA, 'sm' = compact header pill. */
  size?: 'md' | 'sm';
  className?: string;
  children?: ReactNode;
}

/** With `href` the button renders as a real <a> — the OAuth Connect/Disconnect
 * actions are top-level 302 navigations, not fetches, and must stay links. */
type AnchorButtonProps = CommonButtonProps & { href: string } & Omit<
    AnchorHTMLAttributes<HTMLAnchorElement>,
    'href' | 'className'
  >;
type NativeButtonProps = CommonButtonProps & { href?: undefined } & Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'className'
  >;

export type ButtonProps = AnchorButtonProps | NativeButtonProps;

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  href,
  children,
  ...rest
}: ButtonProps) {
  const classes = cx('ui-btn', `ui-btn-${variant}`, `ui-btn-${size}`, className);
  if (href !== undefined) {
    // rest is the anchor arm's remainder; TS can't carry the discrimination
    // through the destructure, hence the assertion.
    return (
      <a href={href} className={classes} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {children}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={classes}
      {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
    >
      {children}
    </button>
  );
}
