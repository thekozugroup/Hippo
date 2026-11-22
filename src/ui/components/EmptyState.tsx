import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cx } from '../cx.ts'
import './EmptyState.css'

export interface EmptyStateProps extends Omit<ComponentPropsWithRef<'div'>, 'title'> {
  /** Two-tone headline, usually a `TwoTone`. */
  title: ReactNode
  /** One supporting sentence. */
  description?: ReactNode
  /** One action, usually a `Button`. */
  action?: ReactNode
  /** Heading level of the title (default 2). */
  headingLevel?: 1 | 2 | 3
}

/** Empty list or first-run state: two-tone headline, one sentence, one action. */
export function EmptyState({ title, description, action, headingLevel = 2, className, ...rest }: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const
  return (
    <div {...rest} className={cx('empty-state', className)}>
      <Heading className="empty-state__title">{title}</Heading>
      {description ? <p className="empty-state__desc">{description}</p> : null}
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  )
}
