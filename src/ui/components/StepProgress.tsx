import { useId, type ComponentPropsWithRef } from 'react'
import { cx } from '../cx.ts'
import './StepProgress.css'

export interface StepProgressProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** The current step, from 1. Steps up to and including it show as done. */
  current: number
  /** Number of steps. */
  total: number
  /** Text for screen readers; defaults to "Step 2 of 5". Point a heading's `aria-describedby` at `id`. */
  text?: string
}

/**
 * Small progress dots for a stepped flow. The first dot is already lit on step 1, so the flow
 * starts partly done. The dots are decorative; the text ("Step 2 of 5") is what assistive tech reads.
 */
export function StepProgress({ current, total, text, id, className, ...rest }: StepProgressProps) {
  const fallbackId = useId()
  const textId = id ?? fallbackId
  const n = Math.max(1, Math.min(20, Math.round(total)))
  const at = Math.max(1, Math.min(n, Math.round(current)))
  return (
    <div {...rest} className={cx('step-progress', className)}>
      <span id={textId} className="sr-only">
        {text ?? `Step ${at} of ${n}`}
      </span>
      <span className="step-progress__dots" aria-hidden="true">
        {Array.from({ length: n }, (_, i) => (
          <span key={i} className={cx('step-progress__dot', i < at && 'is-done', i === at - 1 && 'is-current')} />
        ))}
      </span>
    </div>
  )
}
