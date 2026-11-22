import type { ReactNode } from 'react'
import { cx } from '../cx.ts'
import { HeroBackground } from './HeroBackground.tsx'
import { Sheet } from './Sheet.tsx'
import './Screen.css'

export interface ScreenProps {
  /** Top bar and any hero content; sits on the hero. */
  hero?: ReactNode
  /** Optional hero headline (use `TwoTone`); keep it short so it stays in the hero's upper region. */
  headline?: ReactNode
  /** Sheet content. */
  children?: ReactNode
  /** Floating navigation, pinned to the bottom of the column. */
  nav?: ReactNode
  /** Hero field variant. */
  variant?: 'blue' | 'dark'
  /** Render the sheet as `main` (default) or a plain `div`. */
  sheetAs?: 'main' | 'div' | 'section'
  /** Fit its content instead of filling the viewport (used for previews). */
  contained?: boolean
  className?: string
}

/** Page layout: hero area on top, sheet rising over it, optional floating nav. */
export function Screen({
  hero,
  headline,
  children,
  nav,
  variant = 'blue',
  sheetAs = 'main',
  contained = false,
  className,
}: ScreenProps) {
  return (
    <div className={cx('screen', contained && 'screen--contained', variant === 'dark' && 'screen--dark', nav ? 'screen--has-nav' : false, className)}>
      <div className="screen__top">
        <HeroBackground variant={variant} />
        <div className="screen__col screen__hero">
          {hero}
          {headline ? <div className="screen__headline">{headline}</div> : null}
        </div>
      </div>
      <div className="screen__body">
        <div className="screen__col">
          <Sheet as={sheetAs} className="screen__sheet">
            {children}
          </Sheet>
          {nav ? (
            <div className="screen__nav">
              <div className="screen__nav-inner">{nav}</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
