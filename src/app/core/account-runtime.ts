// The running account sync for the app (loaded on demand by ./account.ts). One engine per page.
// Passes run at start, when the browser comes back online, when the page becomes visible, on the
// same backoff timer as list sync while anything is unsent, after local changes (coalesced), and
// when another device's change arrives live.

import { AccountSync, type AccountSyncStatus, type SyncOutcome } from '../../core/account/sync.ts'
import type { Core } from '../../core/index.ts'
import { startSyncRetry, type SyncRetry } from '../lib/sync-retry.ts'

let engine: AccountSync | null = null
let retry: SyncRetry | null = null

export function startAccountRuntime(core: Core): AccountSync {
  if (engine) {
    retry?.resume()
    return engine
  }
  const e = new AccountSync(core, { onPending: () => retry?.nudge() })
  engine = e
  e.start()
  retry = startSyncRetry(async () => ({ pending: (await e.syncNow()).pending }))
  return e
}

export function resumeAccountRuntime(): void {
  retry?.resume()
}

/** One pass now (after signing in, or "Try again"). */
export function syncAccountNow(): Promise<SyncOutcome> | undefined {
  return engine?.syncNow()
}

export function accountEngine(): AccountSync | null {
  return engine
}

export type { AccountSyncStatus }
