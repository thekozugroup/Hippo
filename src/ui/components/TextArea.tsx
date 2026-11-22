import { useId } from 'react'
import type { ComponentPropsWithRef } from 'react'
import { FieldShell } from './Field.tsx'
import { describedBy, invalidState } from './describedBy.ts'

export interface TextAreaProps extends Omit<ComponentPropsWithRef<'textarea'>, 'id'> {
  /** Visible label above the field. */
  label: string
  /** Helper text under the field. */
  hint?: string
  /** Error text; marks the field invalid. */
  error?: string
  /** Optional id; generated when omitted. */
  id?: string
}

/** Multi-line text field with label, hint and error. `ref` reaches the textarea (React 19). */
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
          aria-invalid={invalidState(error, rest['aria-invalid'])}
          aria-describedby={describedBy(fid, hint, error, rest['aria-describedby'])}
        />
      </div>
    </FieldShell>
  )
}
