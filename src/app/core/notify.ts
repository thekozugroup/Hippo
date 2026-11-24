import { createContext, useContext } from 'react'

export interface NotifyOptions {
  /**
   * Low priority: never replaces a message that is showing (a person may be reading it); it waits
   * until that one has gone. For news nobody acted for, such as "ready to work offline".
   */
  whenFree?: boolean
}

export interface Notify {
  /** Shows a short message in the toast, which is also the polite live region. A newer message replaces the one showing. */
  (message: string, options?: NotifyOptions): void
}

export const NotifyContext = createContext<Notify>(() => undefined)

export function useNotify(): Notify {
  return useContext(NotifyContext)
}
