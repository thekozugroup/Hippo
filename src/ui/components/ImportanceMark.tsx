import type { ComponentPropsWithRef } from 'react'
import { cx } from '../cx.ts'
import './ImportanceMark.css'

export type Importance = 1 | 2 | 3

// Labels follow PRD FR-2: nice = "Nice to have", want = "Want", love = "Would love".
const LABELS: Record<Importance, string> = { 1: 'Nice to have', 2: 'Want', 3: 'Would love' }

export interface ImportanceMarkProps extends Omit<ComponentPropsWithRef<'span'>, 'children'> {
  /** 1 to 3 filled dots. */
  level: Importance
  /** Show the text label (default). When false the label is screen-reader only. */
  showLabel?: boolean
}

/** Three-dot importance indicator with a text label. */
export function ImportanceMark({ level, showLabel = true, className, ...rest }: ImportanceMarkProps) {
  return (
    <span {...rest} className={cx('importance', className)}>
      <span className="importance__dots" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span key={n} className={cx('importance__dot', n <= level && 'is-on')} />
        ))}
      </span>
      <span className={showLabel ? 'importance__label' : 'sr-only'}>{LABELS[level]}</span>
    </span>
  )
}
