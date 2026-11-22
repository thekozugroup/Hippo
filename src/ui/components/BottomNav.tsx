import type { ComponentPropsWithRef, MouseEventHandler, ReactNode } from 'react'
import { cx } from '../cx.ts'
import './BottomNav.css'

export interface BottomNavItem {
  /** Unique id; compared with `activeId`. */
  id: string
  /** Visible label for the active item and accessible name for the rest. */
  label: string
  /** Icon (24px lucide icon). */
  icon: ReactNode
  /** Link destination. */
  href?: string
  /** Click handler (use instead of, or together with, `href`). */
  onClick?: MouseEventHandler<HTMLElement>
}

export interface BottomNavProps extends Omit<ComponentPropsWithRef<'nav'>, 'children' | 'aria-label'> {
  /** Destinations in order. */
  items: ReadonlyArray<BottomNavItem>
  /** Id of the current destination. */
  activeId: string
  /** Accessible name of the navigation landmark. */
  label?: string
}

/** Floating pill navigation: the active item expands with its label. */
export function BottomNav({ items, activeId, label = 'Main', className, ...rest }: BottomNavProps) {
  return (
    <nav {...rest} aria-label={label} className={cx('bottom-nav', 'frost', 'frost--bar', className)}>
      {items.map((item) => {
        const active = item.id === activeId
        const content = (
          <>
            <span className="bottom-nav__icon" aria-hidden="true">
              {item.icon}
            </span>
            {active ? (
              <>
                <span className="bottom-nav__label">{item.label}</span>
                <span className="bottom-nav__dot" aria-hidden="true" />
              </>
            ) : (
              <span className="sr-only">{item.label}</span>
            )}
          </>
        )
        const cls = cx('bottom-nav__item', active && 'is-active')
        const current = active ? ({ 'aria-current': 'page' } as const) : {}
        return item.href ? (
          <a key={item.id} className={cls} href={item.href} onClick={item.onClick} {...current}>
            {content}
          </a>
        ) : (
          <button key={item.id} type="button" className={cls} onClick={item.onClick} {...current}>
            {content}
          </button>
        )
      })}
    </nav>
  )
}
