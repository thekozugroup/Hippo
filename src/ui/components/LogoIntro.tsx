import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cx } from '../cx.ts'
import { durationToken, easingToken, motionOff } from '../motion.ts'
import { Logo, type LogoProps } from './Logo.tsx'
import { INTRO_DEADLINE_MS, INTRO_HOLD_ATTR, INTRO_START_WAIT_MS, introCanStart } from './introGate.ts'
import './LogoIntro.css'

export interface LogoIntroProps extends Omit<LogoProps, 'blink'> {
  /**
   * Play the intro once when this mounts: the logo starts large and centred in the upper part of the
   * viewport, blinks twice, then shrinks and travels to where it sits in the layout. Only the value at
   * mount counts.
   */
  play?: boolean
  /** Called once when the intro really starts, or straight away when motion is off, so the caller can mark it played. */
  onPlay?: () => void
}

const END_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const
/** Largest the logo gets while large, as a multiple of its resting size. */
const MAX_SCALE = 3.5
export type IntroPhase = 'rest' | 'large' | 'travel'

/**
 * The Hippo logo with a one-time brand intro. The resting place is the logo's normal CSS state;
 * the intro only adds an inline `transform` for its two phases (large, then travelling), driven by
 * one clock of timers, never by animation events, and a hard deadline removes it whatever
 * happened. So a stalled animation, a missed event or a script error leaves the logo small and in
 * place. It waits until the page is visible and painted (and, in the Android app, until the splash
 * has gone). Any press, key or scroll lands it at once. With reduced motion it is at rest from
 * the first frame.
 */
export function LogoIntro({ play = false, onPlay, className, ...rest }: LogoIntroProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const [phase, setPhase] = useState<IntroPhase>('rest')
  const onPlayRef = useRef(onPlay)
  useEffect(() => {
    onPlayRef.current = onPlay
  })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !play) return undefined
    if (motionOff()) {
      onPlayRef.current?.()
      return undefined
    }
    const timers: number[] = []
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms))
    const unlisten: Array<() => void> = []
    let landed = false

    const land = () => {
      if (landed) return
      landed = true
      for (const t of timers) window.clearTimeout(t)
      for (const u of unlisten) u()
      el.style.transition = ''
      el.style.transform = ''
      el.style.transformOrigin = ''
      setPhase('rest')
    }

    const begin = () => {
      if (landed) return
      for (const u of unlisten.splice(0)) u()
      const restRect = el.getBoundingClientRect()
      if (restRect.width === 0) {
        land()
        return
      }
      onPlayRef.current?.()
      const vw = document.documentElement.clientWidth || window.innerWidth
      const vh = window.innerHeight
      // Fits narrow screens: at most the viewport width less a gutter on each side.
      const scale = Math.max(1, Math.min(MAX_SCALE, (vw - 2 * 24) / restRect.width))
      const left = (vw - restRect.width * scale) / 2
      const top = Math.max(restRect.top, vh * 0.16)
      const total = durationToken('--dur-intro', 2000)
      const travel = durationToken('--dur-intro-travel', 600)
      el.style.transformOrigin = '0 0'
      el.style.transition = 'none'
      el.style.transform = `translate(${left - restRect.left}px, ${top - restRect.top}px) scale(${scale})`
      setPhase('large')
      later(() => {
        if (landed) return
        el.style.transition = `transform ${travel}ms ${easingToken('--ease-move', 'ease-out')}`
        el.style.transform = 'translate(0px, 0px) scale(1)'
        setPhase('travel')
      }, Math.max(0, total - travel))
      // The end of the clock lands it; the deadline lands it even if that timer was delayed.
      later(land, total + 50)
      later(land, INTRO_DEADLINE_MS)
      const end = () => land()
      for (const type of END_EVENTS) window.addEventListener(type, end, { capture: true, passive: true })
      unlisten.push(() => {
        for (const type of END_EVENTS) window.removeEventListener(type, end, { capture: true })
      })
    }

    if (introCanStart(document)) {
      // Visible now (the website): large from the first frame, no jump.
      begin()
    } else {
      // Hidden, or covered by the app's splash: start once it can be seen, or not at all.
      const check = () => {
        if (introCanStart(document)) begin()
      }
      document.addEventListener('visibilitychange', check)
      const observer = new MutationObserver(check)
      observer.observe(document.documentElement, { attributes: true, attributeFilter: [INTRO_HOLD_ATTR] })
      unlisten.push(() => {
        document.removeEventListener('visibilitychange', check)
        observer.disconnect()
      })
      later(() => {
        if (el.style.transform === '') land()
      }, INTRO_START_WAIT_MS)
    }
    return land
    // Only the value at mount counts: a later change (the caller marking it played) must not cancel it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <Logo {...rest} ref={ref} blink={phase === 'large'} data-intro={phase === 'rest' ? undefined : phase} className={cx(phase !== 'rest' && 'logo--intro', className)} />
}
