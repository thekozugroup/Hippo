import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Toast } from '../../ui/index.ts'
import { NotifyContext, type NotifyOptions } from './notify.ts'

/** One toast for the whole app. Status changes are announced through its live region. */
export function NotifyProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; n: number } | null>(null)
  /** The message on screen, if any (read by notify and dismiss without re-rendering). */
  const showing = useRef<string | null>(null)
  /** A low-priority message waiting for the toast to be free. */
  const waiting = useRef<string | null>(null)
  const show = useCallback((message: string) => {
    showing.current = message
    setToast((prev) => ({ message, n: (prev?.n ?? 0) + 1 }))
  }, [])
  const notify = useCallback(
    (message: string, options?: NotifyOptions) => {
      if (options?.whenFree && showing.current !== null) {
        if (showing.current !== message) waiting.current = message
      } else show(message)
    },
    [show],
  )
  const dismiss = useCallback(() => {
    const next = waiting.current
    waiting.current = null
    if (next !== null) show(next)
    else {
      showing.current = null
      setToast(null)
    }
  }, [show])
  return (
    <NotifyContext value={notify}>
      {children}
      <Toast open={toast !== null} message={toast?.message ?? ''} onDismiss={dismiss} />
    </NotifyContext>
  )
}
