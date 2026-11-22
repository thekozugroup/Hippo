import { useEffect, useRef, useState } from 'react'
import type { ComponentPropsWithRef, ReactNode } from 'react'
import { X } from 'lucide-react'
import { cx } from '../cx.ts'
import { durationToken, motionOff } from '../motion.ts'
import './Toast.css'

export interface ToastProps extends Omit<ComponentPropsWithRef<'div'>, 'children' | 'role'> {
  /** Whether the toast is visible. The live region itself is always mounted. */
  open: boolean
  /** Message text. */
  message: ReactNode
  /** Called when the toast times out or is dismissed. */
  onDismiss: () => void
  /** Milliseconds before auto-dismiss; 0 keeps it until dismissed. Default 8000 (WCAG 2.2.1: long enough to read; hover and focus pause it). */
  duration?: number
  /** Label for the dismiss button. */
  dismissLabel?: string
  /** Render in the normal flow instead of fixed to the viewport (for previews). */
  inline?: boolean
}

/** Pill-shaped status message. Auto-dismisses, pauses on hover and focus, and can be dismissed by keyboard. */
export function Toast({ open, message, onDismiss, duration = 8000, dismissLabel = 'Dismiss', inline = false, className, ...rest }: ToastProps) {
  const [paused, setPaused] = useState(false)
  // Stays on screen while it leaves (sinks and fades), then unmounts.
  const [present, setPresent] = useState(open)
  const [leaving, setLeaving] = useState(false)
  const [lastMessage, setLastMessage] = useState<ReactNode>(message)
  if (open && message !== lastMessage) setLastMessage(message)
  if (open && (!present || leaving)) {
    setPresent(true)
    setLeaving(false)
  } else if (!open && present && !leaving) {
    if (motionOff()) setPresent(false)
    else setLeaving(true)
  }
  useEffect(() => {
    if (!leaving) return
    const id = window.setTimeout(() => {
      setPresent(false)
      setLeaving(false)
    }, durationToken('--dur-exit', 160))
    return () => window.clearTimeout(id)
  }, [leaving])
  const dismiss = useRef(onDismiss)
  useEffect(() => {
    dismiss.current = onDismiss
  })

  useEffect(() => {
    if (!open || paused || duration <= 0) return
    const id = window.setTimeout(() => dismiss.current(), duration)
    return () => window.clearTimeout(id)
  }, [open, paused, duration, message])

  return (
    <div {...rest} className={cx('toast-region', inline && 'toast-region--inline', className)} role="status">
      {present ? (
        <div className={cx('toast', leaving && 'is-leaving')} aria-hidden={leaving || undefined} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
          <span className="toast__message">{open ? message : lastMessage}</span>
          <button type="button" className="toast__close" aria-label={dismissLabel} onClick={onDismiss} tabIndex={leaving ? -1 : undefined}>
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  )
}
