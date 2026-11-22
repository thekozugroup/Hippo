import { createContext, useContext } from 'react'

export interface Notify {
  /** Shows a short message in the toast, which is also the polite live region. */
  (message: string): void
}

export const NotifyContext = createContext<Notify>(() => undefined)

export function useNotify(): Notify {
  return useContext(NotifyContext)
}
