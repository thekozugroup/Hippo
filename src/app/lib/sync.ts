// Re-sync published lists after local edits (FR-12: items are linked, not
// copied). Runs in the background; the local change is already saved, and
// core flags the list so the background retry (core.ts) sends it later if
// no relay accepts it now.

import { syncList, syncListsForItem, type Core, type SyncReport } from '../../core/index.ts'
import { nudgeSyncRetry } from '../core/core.ts'

export const OFFLINE_NOTE = 'Saved on this device. Hippo will update your shared lists when it can reach the sync servers.'

function settle(p: Promise<SyncReport[]>, notify: (m: string) => void): void {
  p.then(
    (reports) => {
      if (reports.some((r) => !r.ok)) {
        nudgeSyncRetry()
        notify(OFFLINE_NOTE)
      }
    },
    () => {
      nudgeSyncRetry()
      notify(OFFLINE_NOTE)
    },
  )
}

export function resyncItem(core: Core, itemId: string, notify: (m: string) => void): void {
  settle(syncListsForItem(core, itemId), notify)
}

export function resyncLists(core: Core, listIds: readonly string[], notify: (m: string) => void): void {
  if (listIds.length === 0) return
  settle(Promise.all(listIds.map((id) => syncList(core, id))), notify)
}
