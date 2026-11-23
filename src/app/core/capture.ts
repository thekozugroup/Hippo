// Share target and deep link entry (PRD FR-8, FR-9). Runs once at startup:
// reads the query string, turns it into a draft item through core's capture
// functions (which validate and length-limit everything; the values are
// attacker-controllable), opens the Add Item form and removes the query
// string from the address bar.
//
// The Android app's share target (another app's Share, then Hippo) arrives
// later and as plain strings, through `captureShared`, which puts them
// through the same `captureFromSearchParams` and `draftFromCapture` path.

import { captureFromSearchParams, draftFromCapture, type DraftItem } from '../../core/index.ts'

let pendingDraft: DraftItem | null = null
/** Changes with every share that arrives while the app runs, so an open Add a wish form starts afresh. */
let epoch = 0
const listeners = new Set<() => void>()

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

/**
 * Text another app shared with Hippo (Android: the subject is usually the page title, the text the
 * link or a sentence containing it). Untrusted: it goes through the same parameter reading and
 * draft building as the web share target and deep link, so the same limits, URL checks and
 * tracking-parameter removal apply. Returns the draft, or null when nothing usable was shared.
 */
export function captureShared(shared: { title?: unknown; text?: unknown }): DraftItem | null {
  const params = new URLSearchParams()
  if (typeof shared.title === 'string') params.set('title', shared.title)
  if (typeof shared.text === 'string') params.set('text', shared.text)
  const capture = captureFromSearchParams(params)
  if (!capture) return null
  pendingDraft = draftFromCapture(capture)
  epoch++
  for (const l of listeners) l()
  return pendingDraft
}

/** The draft from the latest share or deep link, if it has not been used yet. */
export function peekCaptureDraft(): DraftItem | null {
  return pendingDraft
}

export function clearCaptureDraft(): void {
  pendingDraft = null
}

export function captureEpoch(): number {
  return epoch
}

export function subscribeCapture(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
