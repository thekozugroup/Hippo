// Share target and deep link entry (PRD FR-8, FR-9). Runs once at startup:
// reads the query string, turns it into a draft item through core's capture
// functions (which validate and length-limit everything; the values are
// attacker-controllable), opens the Add Item form and removes the query
// string from the address bar.
//
// The Android app's share target (another app's Share, then Hippo) arrives
// later and as plain strings, through `captureShared`, which puts them
// through the same `captureFromSearchParams` and `draftFromCapture` path.

import { captureFromSearchParams, draftFromCapture, LIMITS, type DraftItem } from '../../core/index.ts'

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
  const draft = draftFromShare(shared)
  if (!draft) return null
  pendingDraft = draft
  epoch++
  for (const l of listeners) l()
  return pendingDraft
}

const ANY_URL = /https?:\/\/[^\s<>"'`]+/gi

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function codePoints(s: string, max: number): string {
  const cps = Array.from(s)
  return cps.length > max ? cps.slice(0, max).join('') : s
}

/**
 * The draft for a share from another app, without storing it. The link (the first http(s) address
 * in the text) and the title go through `captureFromSearchParams` and `draftFromCapture` like a
 * deep link. The shared words around the link are kept as well: with no subject they are the
 * wish's name (a shop app sharing "Product name https://…"), and whatever does not fit the name,
 * or words next to a subject, go to the notes. Nothing is ever turned into a link but the link.
 */
export function draftFromShare(shared: { title?: unknown; text?: unknown }): DraftItem | null {
  const title = typeof shared.title === 'string' ? oneLine(shared.title) : ''
  const text = typeof shared.text === 'string' ? shared.text : ''
  const words = oneLine(text.replace(ANY_URL, ' '))
  const params = new URLSearchParams()
  if (title) params.set('title', title)
  else if (words) params.set('title', words)
  if (text.trim()) params.set('text', text)
  const capture = captureFromSearchParams(params)
  if (!capture) return null
  const draft = draftFromCapture(capture)
  if (!draft.title && !draft.url) return null
  const longerThanName = !title && Array.from(words).length > LIMITS.title
  const besideSubject = Boolean(title) && words !== '' && words !== draft.title && !draft.title.includes(words)
  if (longerThanName || besideSubject) draft.notes = codePoints(words, LIMITS.notes)
  return draft
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

/**
 * Where Home sends a first-run owner (`step` is the setup step to resume, or null for a returning
 * one). A share that is waiting for Add a wish wins over setup, so a first launch that begins with
 * a share always ends on the filled-in form; setup comes back on Home afterwards.
 */
export function homeRedirect(step: string | null, captured: boolean): string | null {
  if (!step) return null
  return captured ? '/item/new' : `/welcome/${step}`
}
