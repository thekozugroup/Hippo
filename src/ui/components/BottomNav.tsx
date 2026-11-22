import { useLayoutEffect, useRef, type ComponentPropsWithRef, type MouseEventHandler, type ReactNode, type RefObject } from 'react'
import { cx } from '../cx.ts'
import { durationToken, easingToken, motionOff } from '../motion.ts'
import { mergeRefs } from '../refs.ts'
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
  /**
   * Remember where the active destination was under this key, so when a screen with the same
   * navigation mounts, the indicator moves from the previous destination to the new one and the
   * label fades in, instead of jumping. Use one key per app navigation; leave it out for previews.
   */
  remember?: string
}

interface NavMemory {
  active: string
  /** Left edge of each item and of the active indicator, in viewport pixels. */
  items: Map<string, number>
  indicator: number
}

const memory = new Map<string, NavMemory>()

function measure(nav: HTMLElement, activeId: string): NavMemory {
  const items = new Map<string, number>()
  for (const el of nav.querySelectorAll<HTMLElement>('[data-nav-id]')) items.set(el.dataset.navId ?? '', el.getBoundingClientRect().left)
  const icon = nav.querySelector<HTMLElement>('.is-active .bottom-nav__icon')
  return { active: activeId, items, indicator: icon?.getBoundingClientRect().left ?? 0 }
}

/** Moves the indicator from the destination that was active on the previous screen (FLIP). */
function useIndicatorMotion(nav: RefObject<HTMLElement | null>, key: string | undefined, activeId: string): void {
  useLayoutEffect(() => {
    const el = nav.current
    if (!el || !key) return
    const prev = memory.get(key)
    const now = measure(el, activeId)
    memory.set(key, now)
    const remeasure = () => {
      if (nav.current) memory.set(key, measure(nav.current, activeId))
    }
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(remeasure)
    ro?.observe(el)
    if (prev && prev.active !== activeId && !motionOff()) {
      const duration = durationToken('--dur-page', 280)
      const easing = easingToken('--ease-move', 'ease-out')
      for (const item of el.querySelectorAll<HTMLElement>('[data-nav-id]')) {
        const id = item.dataset.navId ?? ''
        if (id === activeId) {
          const icon = item.querySelector<HTMLElement>('.bottom-nav__icon')
          const dx = prev.indicator - now.indicator
          if (icon && Math.abs(dx) > 0.5) icon.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration, easing })
          for (const part of item.querySelectorAll<HTMLElement>('.bottom-nav__label, .bottom-nav__dot')) {
            part.animate([{ opacity: 0 }, { opacity: 1 }], { duration: durationToken('--dur', 180), delay: duration * 0.4, easing: 'linear', fill: 'backwards' })
          }
        } else {
          const before = prev.items.get(id)
          const after = now.items.get(id)
          if (before !== undefined && after !== undefined && Math.abs(before - after) > 0.5) {
            item.animate([{ transform: `translateX(${before - after}px)` }, { transform: 'none' }], { duration, easing })
          }
        }
      }
    }
    return () => ro?.disconnect()
  }, [nav, key, activeId])
}

/** Floating pill navigation: the active item expands with its label. */
export function BottomNav({ items, activeId, label = 'Main', remember, className, ref, ...rest }: BottomNavProps) {
  const own = useRef<HTMLElement>(null)
  useIndicatorMotion(own, remember, activeId)
  return (
    <nav {...rest} ref={mergeRefs(own, ref)} aria-label={label} className={cx('bottom-nav', 'frost', 'frost--bar', className)}>
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
          <a key={item.id} className={cls} href={item.href} onClick={item.onClick} data-nav-id={item.id} {...current}>
            {content}
          </a>
        ) : (
          <button key={item.id} type="button" className={cls} onClick={item.onClick} data-nav-id={item.id} {...current}>
            {content}
          </button>
        )
      })}
    </nav>
  )
}
