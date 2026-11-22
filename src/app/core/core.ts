// The single Core instance for the running app. `applyRelayOverrideFromUrl`
// must run before `createCore`, so both happen here, once.

import { applyRelayOverrideFromUrl, createCore, type Core } from '../../core/index.ts'

let instance: Core | null = null

export function getAppCore(): Core {
  if (!instance) {
    applyRelayOverrideFromUrl(window.location.href)
    instance = createCore()
  }
  return instance
}
