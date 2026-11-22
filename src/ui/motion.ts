// Motion helpers for components that animate with the Web Animations API.
// Timings come from the motion tokens in styles/tokens.css, read at run time,
// so CSS and script never drift apart.

import { useLayoutEffect, useRef, type RefObject } from 'react'

const cache = new Map<string, number>()

/** A duration token (`--dur-page`) in milliseconds; `fallback` when it cannot be read. */
export function durationToken(name: string, fallback: number): number {
  const hit = cache.get(name)
  if (hit !== undefined) return hit
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const ms = raw.endsWith('ms') ? parseFloat(raw) : raw.endsWith('s') ? parseFloat(raw) * 1000 : NaN
  const value = Number.isFinite(ms) ? ms : fallback
  if (Number.isFinite(ms)) cache.set(name, value)
  return value
}

/** An easing token (`--ease-move`); `fallback` when it cannot be read. */
export function easingToken(name: string, fallback: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** True when animation should be skipped: reduced motion, or no Web Animations support. */
export function motionOff(): boolean {
  if (typeof window === 'undefined' || typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function') return true
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * FLIP for a list: children that moved since the last render glide from their old place, and
 * children that are new rise in. Positions are measured relative to the container, so scrolling
 * between renders does not count as a move. Nothing animates on the first render. Children are
 * tracked by element identity (React keeps keyed elements), so no keys are needed here.
 */
export function useListMotion(ref: RefObject<HTMLElement | null>, enabled = true): void {
  const last = useRef<WeakMap<Element, number> | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    const base = el.getBoundingClientRect().top
    const next = new WeakMap<Element, number>()
    const kids = Array.from(el.children)
    for (const k of kids) next.set(k, k.getBoundingClientRect().top - base)
    const prev = last.current
    last.current = next
    if (!prev || motionOff()) return
    const dur = durationToken('--dur-page', 280)
    const ease = easingToken('--ease-move', 'ease-out')
    let entering = 0
    for (const k of kids) {
      const now = next.get(k) ?? 0
      const before = prev.get(k)
      if (before === undefined) {
        k.animate(
          [
            { opacity: 0, transform: 'translateY(8px)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: durationToken('--dur', 180), delay: Math.min(entering++, 5) * durationToken('--stagger', 18), easing: ease, fill: 'backwards' },
        )
      } else if (Math.abs(before - now) > 0.5) {
        k.animate([{ transform: `translateY(${before - now}px)` }, { transform: 'none' }], { duration: dur, easing: ease })
      }
    }
  })
}
