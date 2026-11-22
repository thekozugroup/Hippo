import type { ComponentPropsWithRef } from 'react'
import { cx } from '../cx.ts'
import './HeroBackground.css'

export interface HeroBackgroundProps extends ComponentPropsWithRef<'div'> {
  /** `blue` follows the theme (blue in light, deep glow in dark); `dark` is always dark. */
  variant?: 'blue' | 'dark'
}

/** The grainy gradient field that sits behind a screen's top bar and sheet. */
export function HeroBackground({ variant = 'blue', className, ...rest }: HeroBackgroundProps) {
  return (
    <div
      aria-hidden="true"
      {...rest}
      className={cx('hero-bg', variant === 'dark' && 'hero-bg--dark', className)}
    />
  )
}
