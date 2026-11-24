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

/** Where the app remembers a site address the person chose (Settings, "Use my own Hippo site"). Per device, not in backups. */
export const SITE_STORAGE_KEY = 'hippo:site'

export interface ChosenSite {
  /** `https://host/path/`, always ending in `/`. */
  url: string
  /** The host Hippo connected to when it checked the site (after redirects). */
  host: string
  checkedAt: number
  /** The site's relays that were adopted as this device's relays (so a later change can replace them). */
  adoptedRelays?: string[]
}

function readChosenSite(): ChosenSite | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(SITE_STORAGE_KEY)
    if (!raw) return undefined
    const v = JSON.parse(raw) as Partial<ChosenSite>
    if (typeof v.url !== 'string' || typeof v.host !== 'string' || typeof v.checkedAt !== 'number') return undefined
    const u = new URL(v.url)
    if (u.protocol !== 'https:' || !v.url.endsWith('/')) return undefined
    const adopted = Array.isArray(v.adoptedRelays) && v.adoptedRelays.every((r) => typeof r === 'string') ? v.adoptedRelays : undefined
    return { url: v.url, host: v.host, checkedAt: v.checkedAt, ...(adopted ? { adoptedRelays: adopted } : {}) }
  } catch {
    return undefined
  }
}

let chosen: ChosenSite | undefined = __HIPPO_NATIVE__ ? readChosenSite() : undefined
const siteListeners = new Set<() => void>()

/** The site the person chose in the app, if any (the built-in one otherwise). */
export function chosenSite(): ChosenSite | undefined {
  return chosen
}

/** The Hippo website the app's links point at: the one the person chose, else the one built in. */
export function siteAddress(): string {
  return chosen?.url ?? PUBLIC_SITE_URL
}

/** Saves (or, with undefined, forgets) the chosen site. Only the app calls this. */
export function setChosenSite(site: ChosenSite | undefined): void {
  chosen = site
  try {
    if (site) globalThis.localStorage?.setItem(SITE_STORAGE_KEY, JSON.stringify(site))
    else globalThis.localStorage?.removeItem(SITE_STORAGE_KEY)
  } catch {
    // Storage unavailable: it lasts until the app closes.
  }
  for (const fn of siteListeners) fn()
}

export function onSiteChange(fn: () => void): () => void {
  siteListeners.add(fn)
  return () => siteListeners.delete(fn)
}

/** The base for share links: the public website inside the app, this page's address on the website. Pure, for tests. */
export function shareBaseFor(native: boolean, site: string, loc: Pick<Location, 'origin' | 'pathname'>): string {
  return native && site ? site : appBaseUrl(loc)
}

/** The base every share link, copied link and Hippo address shown to people is built on. */
export function shareBaseUrl(loc: Pick<Location, 'origin' | 'pathname'> = window.location): string {
  return shareBaseFor(isNativeApp(), siteAddress(), loc)
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

/** Like `payloadFromSiteLink`, for a transfer link (`<site>#/t/<payload>`). */
export function transferPayloadFromSiteLink(link: string, site: string): string | undefined {
  if (!site || link.length > 8192) return undefined
  try {
    const u = new URL(link)
    const s = new URL(site)
    if (u.protocol !== 'https:' || u.username || u.password || u.host !== s.host) return undefined
    return /^#\/t\/([A-Za-z0-9_-]{1,4096})$/.exec(u.hash)?.[1]
  } catch {
    return undefined
  }
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
