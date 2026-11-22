// The single Core instance for the running app. `applyRelayOverrideFromUrl`
// must run before `createCore`, so both happen here, once.

import { applyRelayOverrideFromUrl, createCore, repairRetiredLists, type Core } from '../../core/index.ts'

let instance: Core | null = null

export function getAppCore(): Core {
  if (!instance) {
    applyRelayOverrideFromUrl(window.location.href)
    const core = createCore()
    instance = core
    // Finish cutting off old links of rotated or deleted lists (retried every start and when back online).
    const retry = () => void repairRetiredLists(core).catch(() => undefined)
    retry()
    window.addEventListener('online', retry)
  }
  return instance
}
