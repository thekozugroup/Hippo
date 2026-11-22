import type { ComponentPropsWithRef } from 'react'
import { cx } from '../cx.ts'
import './StatusPill.css'

export type Status =
  | 'available'
  | 'partial'
  | 'funded'
  | 'claimed'
  | 'purchased'
  | 'removed'
  | 'conflict'
  | 'draft'
  | 'published'

const LABELS: Record<Status, string> = {
  available: 'Available',
  partial: 'Partly funded',
  funded: 'Funded',
  claimed: 'Claimed',
  purchased: 'Purchased',
  removed: 'Removed',
  conflict: 'Conflict',
  draft: 'Draft',
  published: 'Published',
}

export interface StatusPillProps extends Omit<ComponentPropsWithRef<'span'>, 'children'> {
  /** Which state to show. */
  status: Status
  /** Overrides the default text label (colour is never the only signal). */
  label?: string
}

/** Small status pill with a dot glyph and a text label. */
export function StatusPill({ status, label, className, ...rest }: StatusPillProps) {
  return (
    <span {...rest} className={cx('status-pill', `status-pill--${status}`, className)}>
      <span className="status-pill__dot" aria-hidden="true" />
      {label ?? LABELS[status]}
    </span>
  )
}
