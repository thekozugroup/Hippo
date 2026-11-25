// Your Hippo account, as far as the first screen needs it: a few bytes that check whether this
// device is signed in, and load the sync engine (src/core/account) only then, after start. Screens
// that turn the account on call `startAccountSync` themselves.

import type { Core } from '../../core/index.ts'

type Runtime = typeof import('./account-runtime.ts')

let loading: Promise<Runtime> | null = null

function runtime(): Promise<Runtime> {
  loading ??= import('./account-runtime.ts')
  return loading
}

/** Starts background sync for this device's account (once). Resolves when the engine runs. */
export async function startAccountSync(core: Core): Promise<void> {
  const r = await runtime()
  r.startAccountRuntime(core)
}

/** At app start: only a device that is signed in loads the engine. */
export function bootAccount(core: Core): void {
  void core.db.settings
    .get('account')
    .then((row) => (row ? startAccountSync(core) : undefined))
    .catch(() => undefined)
}

/** The Android app came back to the foreground: sync now, as the website does when a page becomes visible. */
export function resumeAccount(): void {
  if (loading) void loading.then((r) => r.resumeAccountRuntime())
}
