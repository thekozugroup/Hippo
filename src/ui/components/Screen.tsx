import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cx } from '../cx.ts'
import { HeroBackground } from './HeroBackground.tsx'
import { Sheet } from './Sheet.tsx'
import './Screen.css'

export interface ScreenProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** Top bar and any hero content; sits on the hero. */
  hero?: ReactNode
  /** Optional hero headline (use `TwoTone`); any length is safe: the hero gradient's light end sits below the text zone. */
  headline?: ReactNode
  /** Sheet content. */
  children?: ReactNode
  /** Floating navigation, pinned to the bottom of the column (compact windows only). */
  nav?: ReactNode
  /** Side navigation at the inline start (`SideNav`), shown on medium and expanded windows only. */
  rail?: ReactNode
  /** Hero field variant. */
  variant?: 'blue' | 'dark'
  /** Render the sheet as `main` (default) or a plain `div`. */
  sheetAs?: 'main' | 'div' | 'section'
  /** Fit its content instead of filling the viewport (used for previews). */
  contained?: boolean
}

/**
 * Page layout: hero area on top, sheet rising over it, optional floating nav. On medium and expanded
 * windows (src/ui/layout.ts) the hero becomes a band across the top of the content area holding the
 * title and its actions, the sheet fills the content area under it, and `rail` replaces `nav`.
 */
export function Screen({
  hero,
  headline,
  children,
  nav,
  rail,
  variant = 'blue',
  sheetAs = 'main',
  contained = false,
  className,
  ...rest
}: ScreenProps) {
  return (
    <div
      {...rest}
      className={cx('screen', contained && 'screen--contained', variant === 'dark' && 'screen--dark', nav ? 'screen--has-nav' : false, rail ? 'screen--has-rail' : false, className)}
    >
      {rail ? <div className="screen__rail">{rail}</div> : null}
      <div className="screen__top">
        <HeroBackground variant={variant} />
        <div className="screen__col screen__hero">
          <div className="screen__hero-inner">
            {hero}
            {headline ? <div className="screen__headline">{headline}</div> : null}
          </div>
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
