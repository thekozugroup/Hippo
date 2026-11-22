import type { ReactNode } from 'react'
import { cx } from '../cx.ts'
import './Field.css'

export interface FieldShellProps {
  /** Id of the control, so the label points at it. */
  id: string
  /** Visible label above the field. */
  label: string
  /** Helper text under the field. */
  hint?: string | undefined
  /** Error text; also marks the field invalid. */
  error?: string | undefined
  /** The control itself. */
  children: ReactNode
  className?: string | undefined
}

/** Shared label, hint and error layout for form controls. */
export function FieldShell({ id, label, hint, error, children, className }: FieldShellProps) {
  return (
    <div className={cx('field', error && 'has-error', className)}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="field__error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
      {hint ? (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}
