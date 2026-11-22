import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { cx } from '../cx.ts'
import './IconButton.css'

export interface IconButtonProps extends Omit<ComponentPropsWithoutRef<'button'>, 'children' | 'aria-label'> {
  /** Accessible name; required because the button has no visible text. */
  'aria-label': string
  /** The icon (24px lucide icon). */
  icon: ReactNode
  /** `frost` sits on the hero, `neutral` on the sheet. */
  variant?: 'frost' | 'neutral' | 'ghost'
  /** `md` is 44px, `lg` is 48px. */
  size?: 'md' | 'lg'
}

/** Circular icon button; always at least 44px. */
export function IconButton({ icon, variant = 'neutral', size = 'md', className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={cx('icon-btn', `icon-btn--${variant}`, `icon-btn--${size}`, variant === 'frost' && 'frost frost--on-hero', className)}
    >
      <span className="icon-btn__icon" aria-hidden="true">
        {icon}
      </span>
    </button>
  )
}
