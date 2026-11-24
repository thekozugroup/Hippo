import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cx } from '../cx.ts'
import { Logo } from './Logo.tsx'
import './SideNav.css'

export interface SideNavItem {
  /** Unique id; compared with `activeId`. */
  id: string
  label: string
  /** Icon (24px lucide icon). */
  icon: ReactNode
  href: string
}

export interface SideNavProps extends Omit<ComponentPropsWithRef<'nav'>, 'children' | 'aria-label'> {
  /** Destinations in order (the same as the bottom navigation's). */
  items: ReadonlyArray<SideNavItem>
  /** Id of the current destination; omit when the screen is not one of them. */
  activeId?: string
  /** Accessible name of the navigation landmark. */
  label?: string
  /** Where the Hippo mark and name lead. */
  homeHref: string
  homeLabel?: string
  /** The one primary action, a link: label, icon and destination. */
  action?: { label: string; icon: ReactNode; href: string }
  /**
   * `auto` (default) follows the window: a narrow rail (icons over short labels) on medium widths
   * and a sidebar (icons beside labels) on expanded ones. `rail` and `sidebar` pin one form (previews).
   */
  form?: 'auto' | 'rail' | 'sidebar'
}

/**
 * The navigation on tablets and computers: a frosted panel on the hero field at the inline start,
 * with the Hippo mark and name, the primary action and the destinations as vertical items. The
 * current one is a white pill (`aria-current="page"`), as the bottom navigation's active item.
 */
export function SideNav({ items, activeId, label = 'Main', homeHref, homeLabel = 'Hippo home', action, form = 'auto', className, ...rest }: SideNavProps) {
  return (
    <nav {...rest} aria-label={label} className={cx('side-nav', 'frost', 'frost--on-hero', `side-nav--${form}`, className)}>
      <a className="side-nav__brand" href={homeHref} aria-label={homeLabel}>
        <Logo size={30} />
      </a>
      {action ? (
        <a className="side-nav__action" href={action.href}>
          <span className="side-nav__icon" aria-hidden="true">
            {action.icon}
          </span>
          <span className="side-nav__label">{action.label}</span>
        </a>
      ) : null}
      <ul className="side-nav__items" role="list">
        {items.map((item) => {
          const active = item.id === activeId
          return (
            <li key={item.id}>
              <a className={cx('side-nav__item', active && 'is-active')} href={item.href} {...(active ? { 'aria-current': 'page' as const } : {})}>
                <span className="side-nav__icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="side-nav__label">{item.label}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
