// The single Core instance for the running app. `applyRelayOverrideFromUrl`
// must run before `createCore`, so both happen here, once.

import { applyRelayOverrideFromUrl, createCore, retryPendingSync, type Core } from '../../core/index.ts'
import { startSyncRetry, type SyncRetry } from '../lib/sync-retry.ts'

let instance: Core | null = null
let retry: SyncRetry | null = null

export function getAppCore(): Core {
  if (!instance) {
    applyRelayOverrideFromUrl(window.location.href)
    const core = createCore()
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
