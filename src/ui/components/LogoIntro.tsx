import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cx } from '../cx.ts'
import { durationToken, easingToken, motionOff } from '../motion.ts'
import { Logo, type LogoProps } from './Logo.tsx'
import './LogoIntro.css'

export interface LogoIntroProps extends Omit<LogoProps, 'blink'> {
  /**
   * Play the intro once when this mounts: the logo starts large and centred in the upper part of the
   * viewport, blinks twice, then shrinks and travels to where it sits in the layout. Only the value at
   * mount counts.
   */
  play?: boolean
  /** Called once when the intro starts, or straight away when motion is off, so the caller can mark it played. */
  onPlay?: () => void
}

const END_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const
/** Largest the logo gets while large, as a multiple of its resting size. */
const MAX_SCALE = 3.5

/**
 * The Hippo logo with a one-time brand intro. It is a single element at its normal place in the
 * layout the whole time; the intro only moves it with `transform` (a FLIP between the two measured
 * positions), so nothing shifts when it lands and there is one logo for assistive technology.
 * It is decorative, never takes pointer events, and any press, key or scroll snaps it to its place.
 * With reduced motion it is simply at its place from the first frame.
 */
export function LogoIntro({ play = false, onPlay, className, ...rest }: LogoIntroProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const [running, setRunning] = useState(false)
  const onPlayRef = useRef(onPlay)
  useEffect(() => {
    onPlayRef.current = onPlay
  })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !play) return undefined
    onPlayRef.current?.()
    if (motionOff()) return undefined
    const rest = el.getBoundingClientRect()
    if (rest.width === 0) return undefined
    const vw = document.documentElement.clientWidth
    const vh = window.innerHeight
    // Fits narrow screens: at most the viewport width less a gutter on each side.
    const scale = Math.max(1, Math.min(MAX_SCALE, (vw - 2 * 24) / rest.width))
    const left = (vw - rest.width * scale) / 2
    const top = Math.max(rest.top, vh * 0.16)
    const from = `translate(${left - rest.left}px, ${top - rest.top}px) scale(${scale})`
    const total = durationToken('--dur-intro', 2000)
    const travel = durationToken('--dur-intro-travel', 600)
    const holdEnd = Math.max(0, (total - travel) / total)
    el.style.transformOrigin = '0 0'
    const anim = el.animate(
      [
        { transform: from, offset: 0 },
        { transform: from, offset: holdEnd, easing: easingToken('--ease-move', 'ease-out') },
        { transform: 'none', offset: 1 },
      ],
      { duration: total },
    )
    setRunning(true)
    const end = () => anim.cancel()
    anim.onfinish = anim.oncancel = () => setRunning(false)
    for (const type of END_EVENTS) window.addEventListener(type, end, { capture: true, passive: true })
    return () => {
      for (const type of END_EVENTS) window.removeEventListener(type, end, { capture: true })
      anim.onfinish = anim.oncancel = null
      anim.cancel()
      el.style.transformOrigin = ''
    }
    // Only the value at mount counts: a later change (the caller marking it played) must not cancel it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <Logo {...rest} ref={ref} blink={running} className={cx(running && 'logo--intro', className)} />
}
