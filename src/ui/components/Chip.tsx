import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cx } from '../cx.ts'
import './Chip.css'

interface ChipCommon {
  /** Visible label. */
  children: ReactNode
  /** Avatar or emoji shown before the label (decorative). */
  avatar?: ReactNode
  /** `frost` sits on the hero, `neutral` on the sheet. */
  tone?: 'frost' | 'neutral'
}

/** A static label, a link, a button, or (with `selected`) a filter toggle with `aria-pressed`. */
export type ChipProps = ChipCommon &
  (
    | ({ href: string; selected?: undefined } & Omit<ComponentPropsWithRef<'a'>, 'children'>)
    | ({ href?: undefined; selected?: boolean } & Omit<ComponentPropsWithRef<'button'>, 'children' | 'type'>)
  )

/** Pill chip: static label, link, button, or selectable filter. Native props and `ref` reach the element. */
export function Chip(props: ChipProps) {
  const { children, avatar, tone = 'neutral', className, ...rest } = props
  const interactive = Boolean(rest.href || rest.onClick || (!rest.href && rest.selected !== undefined))
  const cls = cx(
    'chip',
    `chip--${tone}`,
    tone === 'frost' && 'frost frost--on-hero',
    !rest.href && rest.selected && 'is-selected',
    interactive && 'chip--interactive',
    className,
  )
  const content = (
    <>
      {avatar ? (
        <span className="chip__avatar" aria-hidden="true">
          {avatar}
        </span>
      ) : null}
      <span className="chip__label">{children}</span>
    </>
  )
  if (rest.href !== undefined) {
    const { selected: _selected, ...anchor } = rest
    void _selected
    return (
      <a {...anchor} className={cls}>
        {content}
      </a>
    )
  }
  const { selected, href: _href, onClick, ...other } = rest
  void _href
  if (onClick || selected !== undefined) {
    return (
      <button {...other} type="button" className={cls} aria-pressed={selected} onClick={onClick}>
        {content}
      </button>
    )
  }
  // A static chip is plain text: ARIA names on a span have no effect, so none are forwarded.
  const { 'aria-label': _label, ref: _ref, ...staticRest } = other
  void _label
  void _ref
  return (
    <span {...(staticRest as ComponentPropsWithRef<'span'>)} className={cls}>
      {content}
    </span>
  )
}
