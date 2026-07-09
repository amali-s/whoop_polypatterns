import type { HTMLAttributes } from 'react';
import { cx } from './cx';
import './components.css';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Rendered element — pick the one that fits the document outline. */
  as?: 'div' | 'section' | 'article';
  /** 'md' = --space-3 (bento tile density, default), 'lg' = --space-6 (hero/auth). */
  padding?: 'md' | 'lg';
  /** 'lg' = --radius-lg default card, 'xl' = --radius-xl large/hero card (§1). */
  radius?: 'lg' | 'xl';
}

/**
 * Base glossy/glass surface (design.md §1): --color-surface under the shared
 * --surface-gloss sheen, --shadow-card + inset gloss, token radii. Every
 * card-like surface (bento tiles via ChartContainer, the auth card) renders
 * on this instead of hand-rolling the treatment.
 */
export function Card({
  as: Tag = 'div',
  padding = 'md',
  radius = 'lg',
  className,
  ...rest
}: CardProps) {
  return (
    <Tag
      className={cx(
        'ui-card',
        padding === 'lg' && 'ui-card-pad-lg',
        radius === 'xl' && 'ui-card-radius-xl',
        className,
      )}
      {...rest}
    />
  );
}
