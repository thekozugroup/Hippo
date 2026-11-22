import { useId } from 'react'
import type { ComponentPropsWithoutRef } from 'react'
import { FieldShell } from './Field.tsx'
import { describedBy } from './describedBy.ts'

export interface TextAreaProps extends Omit<ComponentPropsWithoutRef<'textarea'>, 'id'> {
  /** Visible label above the field. */
  label: string
  /** Helper text under the field. */
  hint?: string
  /** Error text; marks the field invalid. */
  error?: string
  /** Optional id; generated when omitted. */
  id?: string
}

/** Multi-line text field with label, hint and error. */
export function TextArea({ label, hint, error, id, className, rows = 4, ...rest }: TextAreaProps) {
  const auto = useId()
  const fid = id ?? auto
  return (
    <FieldShell id={fid} label={label} hint={hint} error={error} className={className}>
      <div className="field__control field__control--area">
        <textarea
          {...rest}
          id={fid}
          rows={rows}
          className="field__input"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(fid, hint, error)}
        />
      </div>
    </FieldShell>
  )
}
