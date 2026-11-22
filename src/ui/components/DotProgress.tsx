import type { ComponentPropsWithRef } from 'react'
import { cx } from '../cx.ts'
import './DotProgress.css'

export interface DotProgressProps extends Omit<ComponentPropsWithRef<'div'>, 'children' | 'role' | 'aria-label'> {
  /** Progress from 0 to 1. */
  value: number
  /** Accessible name, for example "Funding for Espresso machine". */
  label: string
  /** Text alternative for the value, for example "$120 of $200". Defaults to the percentage. */
  valueText?: string
  /** Dots per row (default 12). */
  columns?: number
  /** Show the percentage next to the dots. */
  showValue?: boolean
}

/** Two-row dot matrix progress indicator exposed as a progressbar. */
export function DotProgress({ value, label, valueText, columns = 12, showValue = false, className, ...rest }: DotProgressProps) {
  const cols = Number.isInteger(columns) && columns >= 1 ? Math.min(columns, 40) : 12
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
  const percent = Math.round(clamped * 100)
  const total = cols * 2
  const filled = Math.round(clamped * total)
  const dots = Array.from({ length: total }, (_, i) => {
    // Fill column by column so both rows advance together.
    return { key: i, on: i < filled, col: Math.floor(i / 2), row: i % 2 }
  })
  return (
    <div {...rest} className={cx('dot-progress', className)}>
      <div
        className="dot-progress__dots"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={valueText ?? `${percent}%`}
        style={{ gridTemplateColumns: `repeat(${cols}, 6px)` }}
      >
        {dots.map((d) => (
          <span
            key={d.key}
            className={cx('dot-progress__dot', d.on && 'is-on')}
            style={{ gridColumn: d.col + 1, gridRow: d.row + 1 }}
            aria-hidden="true"
          />
        ))}
      </div>
      {showValue ? (
        <span className="dot-progress__value" aria-hidden="true">
          {percent}%
        </span>
      ) : null}
    </div>
  )
}
