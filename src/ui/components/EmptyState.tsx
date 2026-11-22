import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { cx } from '../cx.ts'
import './EmptyState.css'

export interface EmptyStateProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  /** Optional decorative icon. */
  icon?: ReactNode
  /** Two-tone headline, usually a `TwoTone`. */
  title: ReactNode
  /** One supporting sentence. */
  description?: ReactNode
  /** One action, usually a `Button`. */
  action?: ReactNode
}

/** Empty list or first-run state: two-tone headline, one sentence, one action. */
export function EmptyState({ icon, title, description, action, className, ...rest }: EmptyStateProps) {
  return (
    <div {...rest} className={cx('empty-state', className)}>
      {icon ? (
        <span className="empty-state__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <h2 className="empty-state__title">{title}</h2>
      {description ? <p className="empty-state__desc">{description}</p> : null}
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  )
}
