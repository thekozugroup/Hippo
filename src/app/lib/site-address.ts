// The public website's address, and which address share links use.
//
// On the website, share links use the page's own address, as they always have (a fork or custom
// domain shares its own address). Inside the Android app the page's address is the app's local
// origin (https://localhost), which nobody else can open, so every link the app makes, copies or
// shares points at the public website instead: PUBLIC_SITE_URL, taken from HIPPO_SITE_URL at
// build time (the Android workflow defaults it to the repository's GitHub Pages address).

import { extractSharePayload, parseShareLink } from '../../core/index.ts'
import { isNativeApp } from '../native/platform.ts'
import { appBaseUrl } from './capture-tools.ts'

/** The public website, e.g. `https://owner.github.io/Hippo/` (always ends in `/`). Empty when the build had no HIPPO_SITE_URL; the app build refuses to start without one. */
export const PUBLIC_SITE_URL: string = __HIPPO_SITE_URL__

/** The base for share links: the public website inside the app, this page's address on the website. Pure, for tests. */
export function shareBaseFor(native: boolean, site: string, loc: Pick<Location, 'origin' | 'pathname'>): string {
  return native && site ? site : appBaseUrl(loc)
}

/** The base every share link, copied link and Hippo address shown to people is built on. */
export function shareBaseUrl(loc: Pick<Location, 'origin' | 'pathname'> = window.location): string {
  return shareBaseFor(isNativeApp(), PUBLIC_SITE_URL, loc)
}

/**
 * The share payload in a link to the public website (`<site>#/l/<payload>`), or undefined when the
 * link is not a share link of that site. Used for links Android hands to the app. The payload is
 * checked for its alphabet only; the giver screen validates it fully. Never logs the link.
 */
export function payloadFromSiteLink(link: string, site: string): string | undefined {
  if (!site || link.length > 8192) return undefined
  let u: URL
  let s: URL
  try {
    u = new URL(link)
    s = new URL(site)
  } catch {
    return undefined
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.host !== s.host) return undefined
  // The site's path with or without its trailing slash (GitHub Pages redirects one to the other).
  const base = s.pathname.endsWith('/') ? s.pathname : `${s.pathname}/`
  if (u.pathname !== base && u.pathname !== base.slice(0, -1) && u.pathname !== `${base}index.html`) return undefined
  const m = /^#\/l\/([A-Za-z0-9_-]{1,4096})$/.exec(u.hash)
  return m?.[1]
}

/**
 * The share payload in text someone pasted: a Hippo share link from any address (forks work too),
 * possibly with words around it, or the bare `#/l/...` part. Undefined unless it decodes as a share
 * link. Never logs the input.
 */
export function payloadFromPastedLink(input: string): string | undefined {
  if (typeof input !== 'string' || input.length > 8192) return undefined
  const token = input
    .trim()
    .split(/\s+/)
    .find((t) => t.includes('#/l/'))
  if (!token) return undefined
  // Trailing punctuation from a sentence ("...#/l/abc.") is not part of a payload.
  const cleaned = token.replace(/[),.;:!?\]}>'"]+$/, '')
  try {
    parseShareLink(cleaned)
    return extractSharePayload(cleaned)
  } catch {
    return undefined
  }
}
