// The device clock notice's state, shared by ClockNoticeProvider (which sets it), ClockNote (which
// shows it at the top of each screen) and Home (which ranks its own notices around it).

import { createContext, use } from 'react'

export interface ClockNoteState {
  /** The notice while it is on screen; null when there is none or it was dismissed. */
  text: string | null
  dismiss: () => void
}

export const ClockNoteContext = createContext<ClockNoteState>({ text: null, dismiss: () => undefined })

/** Whether the clock notice is on screen. */
export function useClockNoteShowing(): boolean {
  return use(ClockNoteContext).text !== null
}
