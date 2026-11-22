import { useId } from 'react'
import type { ComponentPropsWithoutRef } from 'react'
import { cx } from '../cx.ts'
import './Switch.css'

export interface SwitchProps extends Omit<ComponentPropsWithoutRef<'input'>, 'type' | 'role' | 'id'> {
  /** Visible label. */
  label: string
  /** Secondary description under the label. */
  description?: string
  /** Optional id; generated when omitted. */
  id?: string
}

/** On/off switch built on a native checkbox with `role="switch"`. */
export function Switch({ label, description, id, className, ...rest }: SwitchProps) {
  const auto = useId()
  const fid = id ?? auto
  return (
    <label className={cx('switch', className)} htmlFor={fid}>
      <span className="switch__text">
        <span className="switch__label">{label}</span>
        {description ? <span className="switch__desc">{description}</span> : null}
      </span>
      <input {...rest} id={fid} type="checkbox" role="switch" className="switch__input" />
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
    </label>
  )
}
