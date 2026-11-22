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
  partial: 'Partly covered',
  funded: 'Covered',
  claimed: 'Someone is getting this',
  purchased: 'Bought',
  removed: 'Removed',
  conflict: 'Not counted',
  draft: 'Not shared yet',
  published: 'Shared',
}

export interface StatusPillProps extends Omit<ComponentPropsWithRef<'span'>, 'children'> {
  /** Which state to show; picks the tint. */
  status: Status
  /** Overrides the default text label. The word carries the status; the tint is a second cue. */
  label?: string
}

/**
 * Small tinted pill with a status word. Use it for exceptions only: an ordinary state is plain
 * text or nothing at all.
 */
export function StatusPill({ status, label, className, ...rest }: StatusPillProps) {
  return (
    <span {...rest} className={cx('status-pill', `status-pill--${status}`, className)}>
      {label ?? LABELS[status]}
    </span>
  )
}
