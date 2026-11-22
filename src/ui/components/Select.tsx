import { useId } from 'react'
import type { ComponentPropsWithRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { FieldShell } from './Field.tsx'
import { describedBy, invalidState } from './describedBy.ts'

export interface SelectProps extends Omit<ComponentPropsWithRef<'select'>, 'id'> {
  /** Visible label above the field. */
  label: string
  /** Helper text under the field. */
  hint?: string
  /** Error text; marks the field invalid. */
  error?: string
  /** Optional id; generated when omitted. */
  id?: string
}

/** Native select with label, hint and error. `ref` reaches the select (React 19). */
export function Select({ label, hint, error, id, className, children, ...rest }: SelectProps) {
  const auto = useId()
  const fid = id ?? auto
  return (
    <FieldShell id={fid} label={label} hint={hint} error={error} className={className}>
      <div className="field__control field__control--select">
        <select
          {...rest}
          id={fid}
          className="field__input"
          aria-invalid={invalidState(error, rest['aria-invalid'])}
          aria-describedby={describedBy(fid, hint, error, rest['aria-describedby'])}
        >
          {children}
        </select>
        <span className="field__chevron" aria-hidden="true">
          <ChevronDown strokeWidth={1.75} />
        </span>
      </div>
    </FieldShell>
  )
}
