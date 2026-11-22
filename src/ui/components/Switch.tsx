import { useId } from 'react'
import type { ComponentPropsWithRef } from 'react'
import { cx } from '../cx.ts'
import './Switch.css'

export interface SwitchProps extends Omit<ComponentPropsWithRef<'input'>, 'type' | 'role' | 'id'> {
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
  // The name is the label only; the description is announced as a description,
  // not run into the name (the whole row is still the click target).
  const describedBy = [description ? `${fid}-desc` : null, rest['aria-describedby']].filter(Boolean).join(' ') || undefined
  return (
    <label className={cx('switch', className)} htmlFor={fid}>
      <span className="switch__text">
        <span className="switch__label" id={`${fid}-label`}>
          {label}
        </span>
        {description ? (
          <span className="switch__desc" id={`${fid}-desc`}>
            {description}
          </span>
        ) : null}
      </span>
      <input {...rest} id={fid} type="checkbox" role="switch" className="switch__input" aria-labelledby={`${fid}-label`} aria-describedby={describedBy} />
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
    </label>
  )
}
