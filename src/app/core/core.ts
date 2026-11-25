// The single Core instance for the running app. `applyRelayOverrideFromUrl`
// must run before `createCore`, so both happen here, once.

import { applyRelayOverrideFromUrl, createCore, retryPendingSync, TimeSync, type Core } from '../../core/index.ts'
import { startSyncRetry, type SyncRetry } from '../lib/sync-retry.ts'
import { siteAddress } from '../lib/site-address.ts'
import { clockFetch, isNativeApp } from '../native/index.ts'
import { bootAccount, resumeAccount } from './account.ts'
import { applySiteOverrideFromUrl } from '../screens/account/address.ts'

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
 * visible again, and when the device clock jumps. Inside the Android app the page's own origin has no
 * server, so the request goes to the public website through native HTTP; without an answer the
 * device clock is used, as on the website.
 */
function startTimeSync(): TimeSync {
  const nativeFetch = clockFetch()
  const site = siteAddress()
  const sync =
    nativeFetch && site
      ? new TimeSync({ url: site, fetch: nativeFetch, storage: localStore() })
      : new TimeSync({ url: new URL('./', window.location.href), storage: localStore() })
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
    applySiteOverrideFromUrl(window.location.href)
    timeSync = startTimeSync()
    const core = createCore({ clock: timeSync })
    instance = core
    // Finish sending list changes, unpublishes and link cut-offs that no relay
    // has accepted yet: at start, when back online, when the page becomes
    // visible, and on a backoff timer while anything is pending.
    retry = startSyncRetry(() => retryPendingSync(core))
    // Your Hippo account: loads its sync engine only on a signed-in device.
    bootAccount(core)
  }
  return instance
}

/**
 * The Android app came back to the foreground (its WebView may not report it as a visibility
 * change): retry pending sync and measure the clock again if the last answer is old.
 */
export function appResumed(): void {
  if (!isNativeApp()) return
  retry?.resume()
  resumeAccount()
  void timeSync?.refreshIfOlderThan(VISIBLE_REFRESH_MS)
}

/** Asks the background retry to run soon, e.g. after a change could not be sent. No-op in tests that pass their own core. */
export function nudgeSyncRetry(): void {
  retry?.nudge()
}
