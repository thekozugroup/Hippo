import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { cx } from '../cx.ts'
import './TopBar.css'

export interface TopBarProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  /** Leading slot, usually an `IconButton` (menu or back). */
  start?: ReactNode
  /** Trailing slot: profile chip, actions. */
  end?: ReactNode
  /** Optional centre slot, for a short title. */
  children?: ReactNode
}

/** Header row that sits on the hero; respects the top safe-area inset. */
export function TopBar({ start, end, children, className, ...rest }: TopBarProps) {
  return (
    <div {...rest} className={cx('top-bar', className)}>
      <div className="top-bar__start">{start}</div>
      {children ? <div className="top-bar__centre">{children}</div> : null}
      <div className="top-bar__end">{end}</div>
    </div>
  )
}
