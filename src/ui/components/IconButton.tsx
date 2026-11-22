import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cx } from '../cx.ts'
import './IconButton.css'

interface IconButtonCommon {
  /** Accessible name; required because the control has no visible text. */
  'aria-label': string
  /** The icon (24px lucide icon). */
  icon: ReactNode
  /** `frost` sits on the hero, `neutral` on the sheet. */
  variant?: 'frost' | 'neutral' | 'ghost'
  /** `md` is 44px, `lg` is 48px. */
  size?: 'md' | 'lg'
}

export interface IconButtonProps
  extends IconButtonCommon,
    Omit<ComponentPropsWithRef<'button'>, 'children' | 'aria-label'> {}

export interface IconLinkProps extends IconButtonCommon, Omit<ComponentPropsWithRef<'a'>, 'children' | 'aria-label'> {
  /** Destination; use for navigation (for example a back link). */
  href: string
}

function classes(variant: IconButtonCommon['variant'] = 'neutral', size: IconButtonCommon['size'] = 'md', className?: string) {
  return cx('icon-btn', `icon-btn--${variant}`, `icon-btn--${size}`, variant === 'frost' && 'frost frost--on-hero', className)
}

/** Circular icon button; always at least 44px. */
export function IconButton({ icon, variant, size, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button {...rest} type={type} className={classes(variant, size, className)}>
      <span className="icon-btn__icon" aria-hidden="true">
        {icon}
      </span>
    </button>
  )
}

/** A link that looks like an `IconButton` (navigation should be a link, not a button). */
export function IconLink({ icon, variant, size, className, ...rest }: IconLinkProps) {
  return (
    <a {...rest} className={classes(variant, size, className)}>
      <span className="icon-btn__icon" aria-hidden="true">
        {icon}
      </span>
    </a>
  )
}
