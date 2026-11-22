import type { ComponentPropsWithoutRef, MouseEventHandler, ReactNode } from 'react'
import { cx } from '../cx.ts'
import './Chip.css'

export interface ChipProps {
  /** Visible label. */
  children: ReactNode
  /** Avatar or emoji shown before the label (decorative). */
  avatar?: ReactNode
  /** Show a small trailing dot (for example, "has updates"). */
  dot?: boolean
  /** When set, the chip is a filter toggle with `aria-pressed`. */
  selected?: boolean
  /** `frost` sits on the hero, `neutral` on the sheet. */
  tone?: 'frost' | 'neutral'
  /** Makes the chip a button. */
  onClick?: MouseEventHandler<HTMLElement>
  /** Makes the chip a link. */
  href?: string
  className?: string
  /** Accessible name when the visible label is not enough. */
  'aria-label'?: string
}

/** Pill chip: static label, link, button, or selectable filter. */
export function Chip({ children, avatar, dot, selected, tone = 'neutral', onClick, href, className, ...rest }: ChipProps) {
  const cls = cx('chip', `chip--${tone}`, tone === 'frost' && 'frost frost--on-hero', selected && 'is-selected', (onClick || href || selected !== undefined) && 'chip--interactive', className)
  const content = (
    <>
      {avatar ? <span className="chip__avatar" aria-hidden="true">{avatar}</span> : null}
      <span className="chip__label">{children}</span>
      {dot ? <span className="chip__dot" aria-hidden="true" /> : null}
    </>
  )
  if (href && selected === undefined) {
    const anchorRest: ComponentPropsWithoutRef<'a'> = rest
    return (
      <a {...anchorRest} href={href} className={cls} onClick={onClick}>
        {content}
      </a>
    )
  }
  if (onClick || selected !== undefined) {
    return (
      <button {...rest} type="button" className={cls} aria-pressed={selected} onClick={onClick}>
        {content}
      </button>
    )
  }
  return (
    <span {...rest} className={cls}>
      {content}
    </span>
  )
}
