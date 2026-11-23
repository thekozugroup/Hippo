// Helpers for the setup screens: turning the wish answer into a wish (the
// same capture rules as the Add form and the share target), and picking the
// one way to add wishes that fits this device.

import { findFirstHttpUrl, guessTitleFromUrl, LIMITS, stripTrackingParams } from '../../../core/index.ts'

export interface WishDraft {
  title: string
  url?: string
}

/**
 * "Cosy socks", or a pasted shop link with or without words around it. The
 * link is cleaned of tracking parameters; the words, or a title guessed from
 * the link, become the wish's name.
 */
export function parseWish(text: string): WishDraft | null {
  const found = findFirstHttpUrl(text)
  if (!found) {
    const title = text.replace(/\s+/g, ' ').trim()
    return title ? { title } : null
  }
  const url = stripTrackingParams(found)
  const rest = text.replace(found, ' ').replace(/\s+/g, ' ').trim()
  return { title: rest || guessTitleFromUrl(url) || 'A wish', url }
}

const codePointLengthOf = (s: string): number => [...s].length

export function wishError(text: string): string | undefined {
  const draft = parseWish(text)
  if (!draft) return 'Type a wish or paste a link, or skip this step.'
  if (codePointLengthOf(draft.title) > LIMITS.title) return `Keep the name under ${LIMITS.title} characters. You can add notes later.`
  if (draft.url && draft.url.length > LIMITS.url) return 'That link is too long to save.'
  return undefined
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export type CaptureMethod = 'share' | 'shortcut' | 'bookmarklet'

export interface DeviceInfo {
  userAgent: string
  maxTouchPoints: number
}

/**
 * The one capture method to offer: the Shortcut on iPhone and iPad, the share sheet on Android
 * (setup's install step comes just before, so Hippo is usually installed by then), and the
 * bookmarklet on a computer. Installing has its own step, so it is never the answer here.
 */
export function captureMethodFor(d: DeviceInfo): CaptureMethod {
  const ua = d.userAgent
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && d.maxTouchPoints > 1)
  if (ios) return 'shortcut'
  if (/Android/.test(ua)) return 'share'
  return 'bookmarklet'
}
