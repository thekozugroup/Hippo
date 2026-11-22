import { useLayoutEffect, useRef, type ComponentPropsWithRef, type MouseEventHandler, type ReactNode, type RefObject } from 'react'
import { cx } from '../cx.ts'
import { durationToken, easingToken, motionOff } from '../motion.ts'
import { mergeRefs } from '../refs.ts'
import './BottomNav.css'

export interface BottomNavItem {
  /** Unique id; compared with `activeId`. */
  id: string
  /** Label: visible on the active item, clipped away on the others (it stays their accessible name). */
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
   * Remember which destination was active under this key, so when a screen with the same
   * navigation mounts, the previous destination shrinks to a circle while the new one grows
   * into a pill, instead of jumping. Use one key per app navigation; leave it out for previews.
   */
  remember?: string
}

interface NavMemory {
  active: string
  /** Grow value (0 circle .. 1 pill) of each item when the nav was left mid-motion, else null. */
  live: Map<string, number> | null
  /** When the nav was left (performance.now()), so a nav that mounts much later does not animate. */
  at: number
}

const memory = new Map<string, NavMemory>()

/** A nav that mounts within this long of the previous one unmounting is the same bar on a new screen. */
const FRESH_MS = 120

/** The active item holds all the room the circles leave over: grow 1 is a pill, 0 a circle. */
function growOf(item: HTMLElement): number {
  const g = parseFloat(getComputedStyle(item).flexGrow)
  return Number.isFinite(g) ? Math.min(1, Math.max(0, g)) : 0
}

function inkAt(g: number): string {
  if (g <= 0) return 'var(--text)'
  if (g >= 1) return 'var(--ink-on-white)'
  return `color-mix(in srgb, var(--ink-on-white) ${Math.round(g * 1000) / 10}%, var(--text))`
}

/**
 * One motion for a tab switch: every item that changes grows or shrinks on the same clock. The
 * previous destination goes from a pill to a circle while the new one goes from a circle to a
 * pill; their grow values always add up to 1, so the bar (a fixed width) never changes size and
 * the items between them slide. The label is clipped by its item and fades with the width; the
 * white disc behind the icon fades in or out and the icon's ink follows. Icons never move or resize.
 * `from` is where each item is right now, so a switch that interrupts another carries on from
 * where that one was (no jump).
 */
function playSwitch(nav: HTMLElement, activeId: string, prev: NavMemory): Animation[] {
  const targets = Array.from(nav.querySelectorAll<HTMLElement>('[data-nav-id]')).map((item) => {
    const id = item.dataset.navId ?? ''
    const to = id === activeId ? 1 : 0
    const from = prev.live?.get(id) ?? (id === prev.active ? 1 : 0)
    return { item, from, to }
  })
  const moving = targets.filter((t) => Math.abs(t.from - t.to) > 0.01)
  if (moving.length === 0) return []
  const share = Math.max(...moving.map((t) => Math.abs(t.from - t.to)))
  const opts: KeyframeAnimationOptions = {
    duration: durationToken('--dur-page', 280) * Math.max(0.5, share),
    easing: easingToken('--ease-move', 'ease-out'),
  }
  const out: Animation[] = []
  for (const { item, from, to } of moving) {
    out.push(item.animate([{ flexGrow: from }, { flexGrow: to }], opts))
    const label = item.querySelector<HTMLElement>('.bottom-nav__label')
    const disc = item.querySelector<HTMLElement>('.bottom-nav__disc')
    const icon = item.querySelector<HTMLElement>('.bottom-nav__icon')
    if (label) out.push(label.animate([{ opacity: from }, { opacity: to }], opts))
    if (disc) out.push(disc.animate([{ opacity: from }, { opacity: to }], opts))
    if (icon) out.push(icon.animate([{ color: inkAt(from) }, { color: inkAt(to) }], opts))
  }
  return out
}

/** Grows the new destination and shrinks the previous one when the same bar appears on a new screen. */
function useSwitchMotion(nav: RefObject<HTMLElement | null>, key: string | undefined, activeId: string): void {
  useLayoutEffect(() => {
    const el = nav.current
    if (!el || !key) return
    const prev = memory.get(key)
    memory.set(key, { active: activeId, live: null, at: performance.now() })
    let running: Animation[] = []
    if (prev && prev.active !== activeId && performance.now() - prev.at <= FRESH_MS && !motionOff()) {
      running = playSwitch(el, activeId, prev)
    }
    return () => {
      // Leaving mid-motion: remember where each item is, so the next switch carries on from there.
      const midway = running.some((a) => a.playState === 'running')
      const live = midway ? new Map(Array.from(el.querySelectorAll<HTMLElement>('[data-nav-id]'), (item) => [item.dataset.navId ?? '', growOf(item)] as const)) : null
      memory.set(key, { active: activeId, live, at: performance.now() })
      for (const a of running) a.cancel()
    }
  }, [nav, key, activeId])
}

/**
 * Floating pill navigation: the active item is a pill (icon in a white disc, then its label), the
 * others are circles. The bar has one width whichever destination is active.
 */
export function BottomNav({ items, activeId, label = 'Main', remember, className, ref, ...rest }: BottomNavProps) {
  const own = useRef<HTMLElement>(null)
  useSwitchMotion(own, remember, activeId)
  return (
    <nav {...rest} ref={mergeRefs(own, ref)} aria-label={label} className={cx('bottom-nav', 'frost', 'frost--bar', className)}>
      {items.map((item) => {
        const active = item.id === activeId
        const content = (
          <>
            <span className="bottom-nav__icon" aria-hidden="true">
              <span className="bottom-nav__disc" />
              {item.icon}
            </span>
            <span className="bottom-nav__label">
              <span className="bottom-nav__text">{item.label}</span>
            </span>
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
