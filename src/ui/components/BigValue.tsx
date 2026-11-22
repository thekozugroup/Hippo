import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cx } from '../cx.ts'
import './BigValue.css'

export interface BigValueProps extends Omit<ComponentPropsWithRef<'p'>, 'children'> {
  /** Main part of the value, in the strong colour. */
  value?: ReactNode
  /** Muted secondary part, for example the decimals or a unit. */
  secondary?: ReactNode
  /** Custom content instead of `value` and `secondary`, for example a `MoneyText`. */
  children?: ReactNode
  /** `display` is 56px; `headline` is 40px. */
  size?: 'display' | 'headline'
  /** Use on the hero or dark panels so the muted part stays light. */
  tone?: 'default' | 'on-hero'
}

/** Large, tight, tabular number with an optional lighter secondary part. */
export function BigValue({ value, secondary, children, size = 'display', tone = 'default', className, ...rest }: BigValueProps) {
  return (
    <p {...rest} className={cx('big-value', size === 'display' ? 't-display' : 't-headline', tone === 'on-hero' && 'big-value--on-hero', className)}>
      {children ?? (
        <>
          {value}
          {secondary ? <span className="big-value__secondary">{secondary}</span> : null}
        </>
      )}
    </p>
  )
}
