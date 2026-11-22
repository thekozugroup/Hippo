// Share target and deep link entry (PRD FR-8, FR-9). Runs once at startup:
// reads the query string, turns it into a draft item through core's capture
// functions (which validate and length-limit everything; the values are
// attacker-controllable), opens the Add Item form and removes the query
// string from the address bar.

import { captureFromSearchParams, draftFromCapture, type DraftItem } from '../../core/index.ts'

let pendingDraft: DraftItem | null = null

export function handleStartupCapture(loc: Location = window.location, hist: History = window.history): DraftItem | null {
  if (!loc.search) return null
  const capture = captureFromSearchParams(loc.search)
  const url = new URL(loc.href)
  url.search = ''
  if (capture) {
    pendingDraft = draftFromCapture(capture)
    url.hash = '#/item/new'
  }
  // The query string may also carry `?relays=` (already applied by core).
  hist.replaceState(null, '', url.href)
  return pendingDraft
}

/** The draft from the latest share or deep link, if it has not been used yet. */
export function peekCaptureDraft(): DraftItem | null {
  return pendingDraft
}

export function clearCaptureDraft(): void {
  pendingDraft = null
}
