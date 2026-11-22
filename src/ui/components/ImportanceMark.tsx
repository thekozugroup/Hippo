import { cx } from '../cx.ts'
import './ImportanceMark.css'

export type Importance = 1 | 2 | 3

const LABELS: Record<Importance, string> = { 1: 'Nice to have', 2: 'Would love', 3: 'Really want' }

export interface ImportanceMarkProps {
  /** 1 to 3 filled dots. */
  level: Importance
  /** Show the text label (default). When false the label is screen-reader only. */
  showLabel?: boolean
  className?: string
}

/** Three-dot importance indicator with a text label. */
export function ImportanceMark({ level, showLabel = true, className }: ImportanceMarkProps) {
  return (
    <span className={cx('importance', className)}>
      <span className="importance__dots" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span key={n} className={cx('importance__dot', n <= level && 'is-on')} />
        ))}
      </span>
      <span className={showLabel ? 'importance__label' : 'sr-only'}>{LABELS[level]}</span>
    </span>
  )
}
