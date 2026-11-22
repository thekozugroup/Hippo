import { useId } from 'react'
import type { ComponentPropsWithoutRef } from 'react'
import { Check } from 'lucide-react'
import { cx } from '../cx.ts'
import './Checkbox.css'

export interface CheckboxProps extends Omit<ComponentPropsWithoutRef<'input'>, 'type' | 'id'> {
  /** Visible label. */
  label: string
  /** Optional id; generated when omitted. */
  id?: string
}

/** Checkbox built on a native input. */
export function Checkbox({ label, id, className, ...rest }: CheckboxProps) {
  const auto = useId()
  const fid = id ?? auto
  return (
    <label className={cx('checkbox', className)} htmlFor={fid}>
      <input {...rest} id={fid} type="checkbox" className="checkbox__input" />
      <span className="checkbox__box" aria-hidden="true">
        <Check strokeWidth={2.5} />
      </span>
      <span className="checkbox__label">{label}</span>
    </label>
  )
}
