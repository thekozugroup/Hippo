import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import './Toast.css'

export interface ToastProps {
  /** Whether the toast is visible. The live region itself is always mounted. */
  open: boolean
  /** Message text. */
  message: ReactNode
  /** Called when the toast times out or is dismissed. */
  onDismiss: () => void
  /** Milliseconds before auto-dismiss; 0 keeps it until dismissed. Default 5000. */
  duration?: number
  /** Label for the dismiss button. */
  dismissLabel?: string
  /** Render in the normal flow instead of fixed to the viewport (for previews). */
  inline?: boolean
}

/** Pill-shaped status message. Auto-dismisses, pauses on hover and focus, and can be dismissed by keyboard. */
export function Toast({ open, message, onDismiss, duration = 5000, dismissLabel = 'Dismiss', inline = false }: ToastProps) {
  const [paused, setPaused] = useState(false)
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
    <div className={inline ? 'toast-region toast-region--inline' : 'toast-region'} role="status" aria-live="polite">
      {open ? (
        <div className="toast" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
          <span className="toast__message">{message}</span>
          <button type="button" className="toast__close" aria-label={dismissLabel} onClick={onDismiss}>
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  )
}
