import { useLayoutEffect, useRef, useState, type ComponentPropsWithRef } from 'react'
import { cx } from '../cx.ts'
import { durationToken } from '../motion.ts'
import './DotProgress.css'

/** Dot size plus the smallest gap between columns, in CSS pixels (matches DotProgress.css). */
const DOT = 6
const MIN_GAP = 4
const DEFAULT_COLUMNS = 24

export interface DotProgressProps extends Omit<ComponentPropsWithRef<'div'>, 'children' | 'role' | 'aria-label'> {
  /** Progress from 0 to 1. */
  value: number
  /** Accessible name, for example "Funding for Espresso machine". */
  label: string
  /** Text alternative for the value, for example "20% covered, $199.00 left". Defaults to the percentage. */
  valueText?: string
  /**
   * Dots per row. By default the bar fits as many columns as its width allows (at least a 4px gap),
   * then spreads them so the first and last dots touch the edges.
   */
  columns?: number
}

function columnsFor(width: number): number {
  return Math.max(2, Math.floor((width + MIN_GAP) / (DOT + MIN_GAP)))
}

/** Longest time the whole sequence may take, so a big jump still reads as one quick fill. */
const SEQUENCE_MS = 240

/** Two-row dot matrix that spans its container, exposed as a progressbar. A change fills (or empties) the dots in sequence, once. */
export function DotProgress({ value, label, valueText, columns, className, ...rest }: DotProgressProps) {
  const fixed = columns !== undefined && Number.isInteger(columns) && columns >= 1 ? Math.min(columns, 200) : undefined
  const ref = useRef<HTMLDivElement>(null)
  const [measured, setMeasured] = useState<number | undefined>(undefined)

  useLayoutEffect(() => {
    const el = ref.current
    if (fixed !== undefined || !el) return
    const update = () => {
      const w = el.clientWidth
      if (w > 0) setMeasured(columnsFor(w))
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fixed])

  const cols = fixed ?? measured ?? DEFAULT_COLUMNS
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
  const percent = Math.round(clamped * 100)
  const total = cols * 2
  // Any progress shows at least one column; anything short of complete leaves one dim.
  let filled = Math.round(clamped * cols) * 2
  if (clamped > 0 && filled === 0) filled = 2
  if (clamped < 1 && filled === total) filled = total - 2
  // Dots that change since the last render light up column by column (CSS transition delays).
  // Only a change of value animates; fitting the columns to the width (first layout, resize) does not.
  const [seq, setSeq] = useState({ filled, cols, from: filled })
  if (seq.filled !== filled || seq.cols !== cols) setSeq({ filled, cols, from: seq.cols === cols ? seq.filled : filled })
  const from = seq.cols === cols ? seq.from : filled
  const changedColumns = Math.abs(filled - from) / 2
  const step = changedColumns > 0 ? Math.min(durationToken('--stagger', 18), SEQUENCE_MS / changedColumns) : 0
  const delayFor = (i: number): string | undefined => {
    const lo = Math.min(from, filled)
    const hi = Math.max(from, filled)
    if (i < lo || i >= hi) return undefined
    const col = filled > from ? Math.floor((i - from) / 2) : Math.floor((from - 1 - i) / 2)
    return `${Math.round(col * step)}ms`
  }
  return (
    <div
      {...rest}
      ref={ref}
      className={cx('dot-progress', className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={valueText ?? `${percent}%`}
      style={{ gridTemplateColumns: `repeat(${cols}, ${DOT}px)`, ...rest.style }}
    >
      {Array.from({ length: total }, (_, i) => (
        // Fill column by column so both rows advance together.
        <span
          key={i}
          className={cx('dot-progress__dot', i < filled && 'is-on')}
          style={{ gridColumn: Math.floor(i / 2) + 1, gridRow: (i % 2) + 1, ...(delayFor(i) ? { ['--dot-delay' as string]: delayFor(i) } : {}) }}
          aria-hidden="true"
        />
      ))}
    </div>
  )
}
