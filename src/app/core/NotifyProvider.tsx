import { useCallback, useState, type ReactNode } from 'react'
import { Toast } from '../../ui/index.ts'
import { NotifyContext } from './notify.ts'

/** One toast for the whole app. Status changes are announced through its live region. */
export function NotifyProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; n: number } | null>(null)
  const notify = useCallback((message: string) => {
    setToast((prev) => ({ message, n: (prev?.n ?? 0) + 1 }))
  }, [])
  return (
    <NotifyContext value={notify}>
      {children}
      <Toast open={toast !== null} message={toast?.message ?? ''} onDismiss={() => setToast(null)} />
    </NotifyContext>
  )
}
