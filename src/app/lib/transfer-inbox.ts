// A transfer link's payload on its way to the receive screen. It carries the secret to every list,
// so it is held in memory only: never in the address bar (removed at once with replaceState),
// never in document.title, storage or a log.

import { extractTransferPayload, looksLikeTransferLink } from '../../core/index.ts'

let held: string | undefined

export function holdTransferPayload(payload: string): void {
  held = payload
}

/** The payload waiting for the receive screen, if any. It stays until `clearTransferPayload`. */
export function heldTransferPayload(): string | undefined {
  return held
}

export function clearTransferPayload(): void {
  held = undefined
}

/** The transfer payload in shared or pasted text, if it holds a transfer link. */
export function transferPayloadInText(text: string): string | undefined {
  if (!looksLikeTransferLink(text)) return undefined
  try {
    return extractTransferPayload(text)
  } catch {
    return undefined
  }
}

/**
 * Before anything renders: when the page was opened at `#/t/<payload>`, keep the payload in memory
 * and replace the address with `#/move/receive`, so the secret is not in the address bar, the
 * history or the title even for one frame. Returns whether it did.
 */
export function takeTransferFromLocation(loc: Location = window.location, history: History = window.history): boolean {
  const m = /^#\/t\/([A-Za-z0-9_-]{1,4096})/.exec(loc.hash)
  if (!m?.[1]) return false
  held = m[1]
  const url = new URL(loc.href)
  url.hash = '/move/receive'
  history.replaceState(history.state, '', url.href)
  return true
}
