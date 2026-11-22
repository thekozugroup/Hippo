import { useId } from 'react'
import type { ComponentPropsWithRef } from 'react'
import { cx } from '../cx.ts'
import { FieldShell } from './Field.tsx'
import { describedBy, invalidState } from './describedBy.ts'

export interface TextFieldProps extends Omit<ComponentPropsWithRef<'input'>, 'id'> {
  /** Visible label above the field. */
  label: string
  /** Helper text under the field. */
  hint?: string
  /** Error text; marks the field invalid. */
  error?: string
  /** Optional id; generated when omitted. */
  id?: string
}

/** Single-line text field with label, hint and error. `ref` reaches the input (React 19). */
export function TextField({ label, hint, error, id, className, ...rest }: TextFieldProps) {
  const auto = useId()
  const fid = id ?? auto
  return (
    <FieldShell id={fid} label={label} hint={hint} error={error} className={className}>
      <div className="field__control">
        <input
          {...rest}
          id={fid}
          className={cx('field__input')}
          aria-invalid={invalidState(error, rest['aria-invalid'])}
          aria-describedby={describedBy(fid, hint, error, rest['aria-describedby'])}
        />
      </div>
    </FieldShell>
  )
}
