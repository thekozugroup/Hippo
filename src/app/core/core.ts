// The single Core instance for the running app. `applyRelayOverrideFromUrl`
// must run before `createCore`, so both happen here, once.

import { applyRelayOverrideFromUrl, createCore, retryPendingSync, TimeSync, type Core } from '../../core/index.ts'
import { startSyncRetry, type SyncRetry } from '../lib/sync-retry.ts'

let instance: Core | null = null
let retry: SyncRetry | null = null
let timeSync: TimeSync | null = null

/** Measure again when the app comes back to the foreground, at most this often. */
const VISIBLE_REFRESH_MS = 5 * 60 * 1000

function localStore(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * The corrected clock: the `Date` header of a HEAD request to the app's own address (the host that
 * serves Hippo, never a third party). Measured at start, every 30 minutes, when the page becomes
 * visible again, and when the device clock jumps.
 */
function startTimeSync(): TimeSync {
  const sync = new TimeSync({ url: new URL('./', window.location.href), storage: localStore() })
  void sync.ready()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sync.refreshIfOlderThan(VISIBLE_REFRESH_MS)
  })
  window.addEventListener('online', () => void sync.refresh())
  return sync
}

export function getAppCore(): Core {
  if (!instance) {
    applyRelayOverrideFromUrl(window.location.href)
    timeSync = startTimeSync()
    const core = createCore({ clock: timeSync })
    instance = core
    // Finish sending list changes, unpublishes and link cut-offs that no relay
    // has accepted yet: at start, when back online, when the page becomes
    // visible, and on a backoff timer while anything is pending.
    retry = startSyncRetry(() => retryPendingSync(core))
  }
  return instance
}

/** Asks the background retry to run soon, e.g. after a change could not be sent. No-op in tests that pass their own core. */
export function nudgeSyncRetry(): void {
  retry?.nudge()
}
