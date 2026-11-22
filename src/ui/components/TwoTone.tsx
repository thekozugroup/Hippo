import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cx } from '../cx.ts'
import './TwoTone.css'

export interface TwoToneProps extends Omit<ComponentPropsWithRef<'span'>, 'children'> {
  /** Muted words (the setup of the sentence). */
  muted?: ReactNode
  /** Bright words (the emphasis). */
  bright: ReactNode
  /** `on-hero` and `on-dark` use light-on-dark colours; `default` follows the theme. */
  tone?: 'default' | 'on-hero'
}

/** Two-tone sentence: muted words followed by bright words. */
export function TwoTone({ muted, bright, tone = 'default', className, ...rest }: TwoToneProps) {
  return (
    <span {...rest} className={cx('two-tone', tone === 'on-hero' && 'two-tone--on-hero', className)}>
      {muted ? <span className="two-tone__muted">{muted} </span> : null}
      <span className="two-tone__bright">{bright}</span>
    </span>
  )
}
