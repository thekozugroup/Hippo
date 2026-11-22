import type { ComponentPropsWithRef } from 'react'
import { cx } from '../cx.ts'
import './HeroBackground.css'

export interface HeroBackgroundProps extends ComponentPropsWithRef<'div'> {
  /**
   * `blue` follows the theme (blue in light, deep glow in dark); `dark` is always dark; `night` is the
   * setup field in either theme: grainy blue at the top falling to slate-950 where the text sits.
   */
  variant?: 'blue' | 'dark' | 'night'
}

/** The grainy gradient field that sits behind a screen's top bar and sheet. */
export function HeroBackground({ variant = 'blue', className, ...rest }: HeroBackgroundProps) {
  return (
    <div
      aria-hidden="true"
      // `dark` and `night` are dark in either page theme: data-theme scopes the tokens to this element.
      {...(variant === 'blue' ? {} : { 'data-theme': 'dark' })}
      {...rest}
      className={cx('hero-bg', variant === 'night' && 'hero-bg--night', className)}
    />
  )
}
