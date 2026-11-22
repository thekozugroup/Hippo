import { useId } from 'react'
import type { ComponentPropsWithRef } from 'react'
import { cx } from '../cx.ts'
import './SegmentedControl.css'

export interface SegmentedOption<T extends string> {
  /** Value reported to `onChange`. */
  value: T
  /** Visible label. */
  label: string
}

export interface SegmentedControlProps<T extends string> extends Omit<
  ComponentPropsWithRef<'div'>,
  'onChange' | 'children' | 'role' | 'aria-label'
> {
  /** Accessible name of the group. */
  label: string
  /** The choices (two to four work best). */
  options: ReadonlyArray<SegmentedOption<T>>
  /** Selected value. */
  value: T
  /** Called with the newly selected value. */
  onChange: (value: T) => void
}

/** Pill segmented control built on native radio inputs (arrow keys move the selection). */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
  ...rest
}: SegmentedControlProps<T>) {
  const name = useId()
  return (
    // The box lets the control stack its options when they do not fit side by side (large text).
    <div className="segmented-box">
      <div {...rest} role="radiogroup" aria-label={label} className={cx('segmented', className)}>
        {options.map((opt) => (
          <label key={opt.value} className="segmented__option">
            <input
              type="radio"
              className="segmented__input"
              name={name}
              value={opt.value}
              checked={opt.value === value}
              onChange={() => onChange(opt.value)}
            />
            <span className="segmented__label">{opt.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
