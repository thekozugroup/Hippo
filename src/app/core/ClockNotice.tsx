// Tells the person, plainly, when this device's clock is clearly wrong
// (more than about two minutes off the time Hippo measured). Hippo corrects
// for it either way (core `TimeSync`); the notice only explains it. Nothing
// shows while the clock is fine.
//
// The toast announces it once, when the measurement arrives; but the toast
// has one place and the next message replaces it (on a first visit, "Hippo
// is ready to work offline" follows within a second). So the notice also
// stays at the top of each screen's sheet (`ClockNote`) until it is
// dismissed: a giver is told even when the list takes a while to open.

import { use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Clock, X } from 'lucide-react'
import { IconButton } from '../../ui/index.ts'
import { CLOCK_WARN_MS } from '../../core/index.ts'
import { clockNoticeText } from './clockText.ts'
import { useCore } from './context.ts'
import { useNotify } from './notify.ts'
import { ClockNoteContext } from './clockNote.ts'

const TOLD_KEY = 'hippo:clock-told'

function readTold(): boolean {
  try {
    return localStorage.getItem(TOLD_KEY) !== null
  } catch {
    return false
  }
}

function writeTold(told: boolean): void {
  try {
    if (told) localStorage.setItem(TOLD_KEY, '1')
    else localStorage.removeItem(TOLD_KEY)
  } catch {
    // Storage unavailable: the notice may show again next time.
  }
}


/** Watches the clock correction for the whole app and holds the notice until it is dismissed. */
export function ClockNoticeProvider({ children }: { children: ReactNode }) {
  const core = useCore()
  const notify = useNotify()
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    const clock = core.clockSync
    if (!clock) return
    const check = () => {
      const offset = clock.offset()
      if (offset === undefined) return
      if (Math.abs(offset) <= CLOCK_WARN_MS) {
        // Fixed: if it goes wrong again later, say so again.
        writeTold(false)
        setText(null)
        return
      }
      if (readTold()) return
      writeTold(true)
      const message = clockNoticeText(offset)
      setText(message)
      notify(message)
    }
    check()
    return clock.subscribe(check)
  }, [core, notify])
  const dismiss = useCallback(() => setText(null), [])
  const value = useMemo(() => ({ text, dismiss }), [text, dismiss])
  return <ClockNoteContext value={value}>{children}</ClockNoteContext>
}

/**
 * The clock notice at the top of a screen's sheet, until dismissed. Renders nothing otherwise.
 * `quiet`: a plain line instead of a banner, when a more pressing notice is on the same screen.
 */
export function ClockNote({ quiet = false }: { quiet?: boolean }) {
  const { text, dismiss } = use(ClockNoteContext)
  if (!text) return null
  return (
    <div className={quiet ? 'app-banner app-banner--quiet clock-note' : 'app-banner app-banner--warn clock-note'} role="note" aria-label="Device clock" data-testid="clock-note">
      <Clock aria-hidden="true" />
      <div className="app-banner__body">
        <p>{text}</p>
      </div>
      <IconButton className="clock-note__close" aria-label="Dismiss the clock notice" icon={<X />} onClick={dismiss} />
    </div>
  )
}
