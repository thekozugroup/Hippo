// When the logo intro (LogoIntro) may start, and how long it may take. Plain values, for tests too.

/** However the phases go, the logo is at rest this long after the intro started. */
export const INTRO_DEADLINE_MS = 3000
/** How long the intro waits for the page to be visible and painted (and an app's splash to go); after that it does not play. */
export const INTRO_START_WAIT_MS = 4000
/**
 * Set on `<html>` while something covers the page (the Android app's splash screen). The intro
 * waits until it is removed, so it is never played where nobody can see it.
 */
export const INTRO_HOLD_ATTR = 'data-splash'

/** True when the intro may start now: the page is visible and nothing covers it. Pure, for tests. */
export function introCanStart(doc: Pick<Document, 'visibilityState' | 'documentElement'>): boolean {
  return doc.visibilityState === 'visible' && !doc.documentElement.hasAttribute(INTRO_HOLD_ATTR)
}

