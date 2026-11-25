// "This Hippo site now lives at <host>": the website was opened at an address that is not the one
// it was built for (`site` in hippo.json, embedded at build time as __HIPPO_SITE_URL__). Browsers
// keep storage per address, so the wishes here are invisible there until the person carries them
// across with one tap (a device link to the new address). Pure parts here; the notice is lazy.

import { PUBLIC_SITE_URL } from '../../lib/site-address.ts'

/**
 * End-to-end tests serve the same build on two loopback addresses and cannot rebuild it for each,
 * so `?site=<loopback url>` on a loopback page stands in for the built-in address for that tab
 * only, like the relay override (PROTOCOL.md section 7). Ignored anywhere else.
 */
export const SITE_TEST_STORAGE_KEY = 'hippo:site-test'
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

function isLoopbackHttp(u: URL): boolean {
  return (u.protocol === 'http:' || u.protocol === 'https:') && LOOPBACK.has(u.hostname) && !u.username && !u.password
}

export function applySiteOverrideFromUrl(href: string, store: Pick<Storage, 'setItem'> | undefined = safeSession()): void {
  try {
    const page = new URL(href)
    const raw = page.searchParams.get('site')
    if (raw === null || !isLoopbackHttp(page)) return
    const site = new URL(raw)
    if (isLoopbackHttp(site)) store?.setItem(SITE_TEST_STORAGE_KEY, site.href)
  } catch {
    // Not a URL: ignored.
  }
}

function safeSession(): Storage | undefined {
  try {
    return globalThis.sessionStorage ?? undefined
  } catch {
    return undefined
  }
}

/** The address this build was made for: the built-in one, or the loopback test stand-in on a loopback page. */
export function builtSiteAddress(loc: Pick<Location, 'href'> = window.location): string {
  try {
    const page = new URL(loc.href)
    const test = safeSession()?.getItem(SITE_TEST_STORAGE_KEY)
    if (test && isLoopbackHttp(page)) return test
  } catch {
    // fall through
  }
  return PUBLIC_SITE_URL
}

/** The site's new address when this page is not on it (origins compared), else undefined. Pure. */
export function movedSiteFor(origin: string, site: string): string | undefined {
  if (!site) return undefined
  try {
    const u = new URL(site)
    if (u.protocol !== 'https:' && !isLoopbackHttp(u)) return undefined
    return u.origin === origin ? undefined : u.href
  } catch {
    return undefined
  }
}

const DISMISS_KEY = 'hippo:site-moved-dismissed'
const DISMISS_MS = 30 * 24 * 60 * 60 * 1000

export function siteNoticeDismissed(now = Date.now()): boolean {
  try {
    const at = Number(globalThis.localStorage?.getItem(DISMISS_KEY))
    return Number.isFinite(at) && at > 0 && now - at < DISMISS_MS
  } catch {
    return false
  }
}

export function dismissSiteNotice(now = Date.now()): void {
  try {
    globalThis.localStorage?.setItem(DISMISS_KEY, String(now))
  } catch {
    // Storage unavailable: shown again next time.
  }
}
