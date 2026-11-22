// Re-sync published lists after local edits (FR-12: items are linked, not
// copied). Runs in the background; the local change is already saved.

import { syncList, syncListsForItem, type Core, type SyncReport } from '../../core/index.ts'

const OFFLINE_NOTE = 'Saved on this device. Your shared lists will catch up when you are back online.'

function settle(p: Promise<SyncReport[]>, notify: (m: string) => void): void {
  p.then(
    (reports) => {
      if (reports.some((r) => !r.ok)) notify(OFFLINE_NOTE)
    },
    () => notify(OFFLINE_NOTE),
  )
}

export function resyncItem(core: Core, itemId: string, notify: (m: string) => void): void {
  settle(syncListsForItem(core, itemId), notify)
}

export function resyncLists(core: Core, listIds: readonly string[], notify: (m: string) => void): void {
  if (listIds.length === 0) return
  settle(Promise.all(listIds.map((id) => syncList(core, id))), notify)
}
