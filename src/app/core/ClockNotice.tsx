// Tells the person once, plainly, when this device's clock is clearly wrong
// (more than about two minutes off the time Hippo measured). Hippo corrects
// for it either way (core `TimeSync`); the notice only explains it. Nothing
// shows while the clock is fine.

import { useEffect } from 'react'
import { CLOCK_WARN_MS } from '../../core/index.ts'
import { clockNoticeText } from './clockText.ts'
import { useCore } from './context.ts'
import { useNotify } from './notify.ts'

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

export function ClockNotice() {
  const core = useCore()
  const notify = useNotify()
  useEffect(() => {
    const clock = core.clockSync
    if (!clock) return
    const check = () => {
      const offset = clock.offset()
      if (offset === undefined) return
      if (Math.abs(offset) <= CLOCK_WARN_MS) {
        // Fixed: if it goes wrong again later, say so again.
        writeTold(false)
        return
      }
      if (readTold()) return
      writeTold(true)
      notify(clockNoticeText(offset))
    }
    check()
    return clock.subscribe(check)
  }, [core, notify])
  return null
}
