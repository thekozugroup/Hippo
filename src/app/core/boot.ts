// The first frame. Before React renders anything, main.tsx decides whether
// this visit is likely a first run that will open setup (no setup hint for
// this database, and the address is Home or a setup step). If so the page
// background is the setup's night field from the very first paint
// (html[data-boot="setup"]) and loading placeholders stay empty, so a new
// owner never sees a light Home placeholder flash before the dark setup
// screen. Returning owners are unaffected: they have the hint and see Home
// at once. The entry script is render-blocking (vite.config.ts), so the
// browser paints nothing before this has run.

import { readSetupHint } from './setupHint.ts'

const ATTR = 'boot'

/** True when the address may lead to setup: Home or a setup step. */
export function mayOpenSetup(hash: string): boolean {
  return hash === '' || hash === '#' || hash === '#/' || hash.startsWith('#/welcome/')
}

/** Sets the setup boot state when this is likely a first run. Returns whether it did. */
export function startBoot(dbName: string, hash: string = window.location.hash): boolean {
  if (readSetupHint(dbName) || !mayOpenSetup(hash)) return false
  document.documentElement.dataset[ATTR] = 'setup'
  return true
}

export function isSetupBoot(): boolean {
  return document.documentElement.dataset[ATTR] === 'setup'
}

/** A real screen is showing: the page background goes back to normal. */
export function endBoot(): void {
  delete document.documentElement.dataset[ATTR]
}
