import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentPropsWithRef, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { cx } from '../cx.ts'
import { assignRef } from '../refs.ts'
import { completesAt, dragIntent, isRepeat, knobOffset, labelOpacity, slideProgress, type DragIntent } from './slide.ts'
import './SlideButton.css'

/** The event a completed slide sends (it bubbles), so the app can add touch feedback without this component knowing about it. */
export const SLIDE_COMPLETE_EVENT = 'slidecomplete'

/**
 * Pointer activations of one control closer together than this count once: a double tap, or a tap
 * during the settle after a slide. The lock belongs to one control instance; a setup step that
 * changes gets a new instance (StepScreen keys it by step), so it never holds back a press on the
 * next question. Keyboard presses are not timed: a held-down Enter (key repeat) is ignored instead.
 */
const REPEAT_LOCK_MS = 350
/** How long after a slide ends the click a browser may still send for that same press is ignored. */
const SLIDE_CLICK_MS = 400

export interface SlideButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children' | 'onClick' | 'aria-label'> {
  /** The visible label and the button's accessible name ("Get started", "Continue"). */
  label: string
  /**
   * Runs once per activation: a tap or click anywhere on the control, Enter or Space, or a slide
   * that crosses the threshold. With `type="submit"` it may be left out: the form then submits.
   */
  onActivate?: () => void
  /** Saving or working: shows a spinner and `busyLabel`, ignores activation and cannot be dragged. */
  busy?: boolean
  busyLabel?: string
  /** Cannot be used: the control is announced as disabled and shows `disabledReason` under its label. */
  disabled?: boolean
  disabledReason?: string
  /** Icon in the knob; an arrow by default (mirrored in right-to-left layouts). */
  icon?: ReactNode
}

interface Drag {
  pointerId: number
  startX: number
  startY: number
  dir: 1 | -1
  max: number
  intent: DragIntent
  offset: number
}

/**
 * The wide pill with a round knob at its start: tap it, or slide the knob to its end. It is a
 * native `<button>` first (one name, Enter and Space, a tap anywhere continues at once); the drag
 * is an enhancement on top. Vertical moves that start on it still scroll the page.
 */
export function SlideButton({
  label,
  onActivate,
  busy = false,
  busyLabel = 'Saving…',
  disabled = false,
  disabledReason,
  icon,
  type = 'button',
  className,
  ref,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onKeyDown,
  ...rest
}: SlideButtonProps) {
  const own = useRef<HTMLButtonElement | null>(null)
  const knob = useRef<HTMLSpanElement>(null)
  const text = useRef<HTMLSpanElement>(null)
  const drag = useRef<Drag | null>(null)
  const lastActivation = useRef<number | undefined>(undefined)
  const suppressClickUntil = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [done, setDone] = useState(false)
  const reasonId = useId()
  const blocked = busy || disabled

  const place = (offset: number, max: number, dir: 1 | -1) => {
    if (knob.current) knob.current.style.transform = offset === 0 ? '' : `translateX(${offset * dir}px)`
    if (text.current) text.current.style.opacity = offset === 0 ? '' : String(labelOpacity(slideProgress(offset, max)))
  }

  // A new label is a new question (the next setup step reuses this control): the knob starts over.
  const [seenLabel, setSeenLabel] = useState(label)
  if (seenLabel !== label) {
    setSeenLabel(label)
    setDone(false)
  }
  useLayoutEffect(() => {
    place(0, 1, 1)
    // A press on the new label is a new decision, never a repeat of the press on the old one.
    lastActivation.current = undefined
  }, [label])

  // After a completed slide the knob waits at the end; it goes back once the work is done.
  useEffect(() => {
    if (!done || busy) return undefined
    const id = window.setTimeout(() => {
      setDone(false)
      place(0, 1, 1)
    }, REPEAT_LOCK_MS)
    return () => window.clearTimeout(id)
  }, [done, busy])

  /**
   * Whether an activation counts. Presses (a tap, a click, a slide) closer together than the lock
   * count once; Enter and Space are never held back (implicit form submission sends them as clicks
   * with `detail` 0), only by `busy`.
   */
  const activate = (pointer: boolean): boolean => {
    if (blocked) return false
    if (!pointer) return true
    const now = performance.now()
    if (isRepeat(now, lastActivation.current, REPEAT_LOCK_MS)) return false
    lastActivation.current = now
    return true
  }

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    const pointer = e.detail > 0
    if ((pointer && performance.now() < suppressClickUntil.current) || !activate(pointer)) {
      e.preventDefault()
      return
    }
    onActivate?.()
  }

  const startDrag = (e: PointerEvent<HTMLButtonElement>) => {
    onPointerDown?.(e)
    const btn = own.current
    const k = knob.current
    if (e.defaultPrevented || blocked || done || !btn || !k || drag.current) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    // Only the knob (with a little room around it) starts a slide; a press elsewhere is a tap.
    const r = k.getBoundingClientRect()
    const near = 12
    if (e.clientX < r.left - near || e.clientX > r.right + near || e.clientY < r.top - near || e.clientY > r.bottom + near) return
    const style = getComputedStyle(btn)
    const inset = parseFloat(style.paddingInlineStart) || 0
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      dir: style.direction === 'rtl' ? -1 : 1,
      max: Math.max(0, btn.clientWidth - k.offsetWidth - 2 * inset),
      intent: 'undecided',
      offset: 0,
    }
  }

  const moveDrag = (e: PointerEvent<HTMLButtonElement>) => {
    onPointerMove?.(e)
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    const dx = (e.clientX - d.startX) * d.dir
    const dy = e.clientY - d.startY
    if (d.intent === 'undecided') {
      d.intent = dragIntent(dx, dy)
      if (d.intent === 'scroll') {
        drag.current = null
        return
      }
      if (d.intent === 'slide') {
        try {
          own.current?.setPointerCapture(e.pointerId)
        } catch {
          // The pointer is already gone.
        }
        setDragging(true)
      }
    }
    if (d.intent !== 'slide') return
    e.preventDefault()
    d.offset = knobOffset(dx, d.max)
    place(d.offset, d.max, d.dir)
  }

  const endDrag = (e: PointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    if (cancelled) onPointerCancel?.(e)
    else onPointerUp?.(e)
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    drag.current = null
    if (d.intent !== 'slide') return
    setDragging(false)
    // The browser may still send a click for this press; the slide decides instead.
    suppressClickUntil.current = performance.now() + SLIDE_CLICK_MS
    if (!cancelled && completesAt(slideProgress(d.offset, d.max)) && activate(true)) {
      place(d.max, d.max, d.dir)
      setDone(true)
      const btn = own.current
      btn?.dispatchEvent(new CustomEvent(SLIDE_COMPLETE_EVENT, { bubbles: true }))
      if (onActivate) onActivate()
      else if (type === 'submit' && btn?.form) btn.form.requestSubmit(btn)
      return
    }
    // Not far enough: spring back (the CSS transition; instant under reduced motion).
    place(0, d.max, d.dir)
  }

  return (
    <button
      {...rest}
      ref={(el) => {
        own.current = el
        assignRef(ref, el)
      }}
      type={type}
      aria-label={label}
      aria-busy={busy || undefined}
      aria-disabled={disabled || undefined}
      aria-describedby={cx(rest['aria-describedby'], disabled && disabledReason ? reasonId : undefined) || undefined}
      className={cx('slide-btn', 'frost', 'frost--on-hero', busy && 'is-busy', disabled && 'is-disabled', dragging && 'is-dragging', done && 'is-done', className)}
      onClick={onClick}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        // A held-down Enter repeats keydown, and each would press the button again: one press is one activation.
        if (e.key === 'Enter' && e.repeat) e.preventDefault()
      }}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={(e) => endDrag(e, false)}
      onPointerCancel={(e) => endDrag(e, true)}
      onLostPointerCapture={(e) => {
        // Only the button's own capture ending counts: taking capture from the knob (touch captures
        // implicitly to the element pressed) also fires this, on the knob, and must not end the slide.
        if (e.target === e.currentTarget && drag.current && drag.current.intent === 'slide' && e.pointerId === drag.current.pointerId) endDrag(e, true)
      }}
    >
      <span ref={knob} className="slide-btn__knob" aria-hidden="true">
        {busy ? <span className="slide-btn__spinner" /> : (icon ?? <ArrowRight className="slide-btn__arrow" />)}
      </span>
      <span className="slide-btn__text">
        <span ref={text} className="slide-btn__label" aria-hidden="true">
          {busy ? busyLabel : label}
        </span>
        {disabled && disabledReason ? (
          <span id={reasonId} className="slide-btn__reason">
            {disabledReason}
          </span>
        ) : null}
      </span>
    </button>
  )
}
