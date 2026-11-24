// "Use my own Hippo site" (Android app): checking that an address is a compatible Hippo website.
// The website publishes a small file at its root, hippo.json (vite.config.ts); the app fetches it
// through its hardened native page fetch (https only, public hosts, every redirect re-checked,
// size and time limits) and reads it as untrusted input.

import { isAcceptablePageUrl, isRelayUrl, LIMITS } from '../../core/index.ts'

export const SITE_INFO_FILE = 'hippo.json'
/** The protocol this copy of Hippo speaks (PROTOCOL.md). A site with another major version is refused. */
export const PROTOCOL_VERSION = 1
export const SITE_INFO_MAX_BYTES = 16 * 1024
export const SITE_TIMEOUT_MS = 8000

export interface SiteInfo {
  app: 'Hippo'
  version: string
  protocol: number
  relays: string[]
}

/** What the native fetch returns (core's FetchedPage). */
export interface FetchedFile {
  status: number
  url: string
  contentType: string
  body: string
}
export type FileFetcher = (url: string) => Promise<FetchedFile>

export type SiteProblem = 'invalid-address' | 'not-https' | 'unreachable' | 'not-hippo' | 'incompatible'
export type SiteCheck = { ok: true; url: string; host: string; info: SiteInfo } | { ok: false; problem: SiteProblem }

/**
 * The address someone typed, as a site base (`https://host/path/`), or a problem. `gifts.example.org`
 * becomes `https://gifts.example.org/`; a pasted link to a page of the site keeps only the path's
 * folder (a file name such as index.html is dropped); query and fragment are dropped (a share link pasted by mistake loses its secret here).
 */
export function normalizeSiteInput(input: string): { url: string } | { problem: 'invalid-address' | 'not-https' } {
  const raw = input.trim()
  if (!raw || raw.length > 2000 || /\s/.test(raw)) return { problem: 'invalid-address' }
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
  let u: URL
  try {
    u = new URL(withScheme)
  } catch {
    return { problem: 'invalid-address' }
  }
  if (u.protocol !== 'https:') return { problem: u.protocol === 'http:' ? 'not-https' : 'invalid-address' }
  if (u.username || u.password || u.port) return { problem: 'invalid-address' }
  u.search = ''
  u.hash = ''
  // A last part with a dot is a file (index.html) and goes; one without is a folder (owner.github.io/Hippo).
  if (!u.pathname.endsWith('/')) u.pathname = /\.[^/]*$/.test(u.pathname) ? u.pathname.replace(/[^/]*$/, '') : `${u.pathname}/`
  if (!isAcceptablePageUrl(u.href)) return { problem: 'invalid-address' }
  return { url: u.href }
}

/** Reads hippo.json. Undefined when it is not a Hippo site's file; 'incompatible' when the protocol differs. */
export function parseSiteInfo(body: string): SiteInfo | 'incompatible' | undefined {
  if (body.length > SITE_INFO_MAX_BYTES) return undefined
  let v: unknown
  try {
    v = JSON.parse(body)
  } catch {
    return undefined
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined
  const o = v as Record<string, unknown>
  if (o.app !== 'Hippo') return undefined
  if (typeof o.protocol !== 'number' || !Number.isSafeInteger(o.protocol)) return undefined
  if (o.protocol !== PROTOCOL_VERSION) return 'incompatible'
  const version = typeof o.version === 'string' && o.version.length <= 40 ? o.version : ''
  if (!Array.isArray(o.relays) || o.relays.length === 0 || o.relays.length > LIMITS.relays) return undefined
  const relays = o.relays.filter((r): r is string => typeof r === 'string' && r.length <= LIMITS.relayUrl && isRelayUrl(r))
  if (relays.length !== o.relays.length) return undefined
  return { app: 'Hippo', version, protocol: o.protocol, relays: [...new Set(relays)] }
}

/** Checks an address. Never throws. */
export async function checkSite(input: string, fetchFile: FileFetcher): Promise<SiteCheck> {
  const n = normalizeSiteInput(input)
  if ('problem' in n) return { ok: false, problem: n.problem }
  let file: FetchedFile
  try {
    file = await fetchFile(n.url + SITE_INFO_FILE)
  } catch {
    return { ok: false, problem: 'unreachable' }
  }
  if (!isAcceptablePageUrl(file.url)) return { ok: false, problem: 'unreachable' }
  if (file.status === 404) return { ok: false, problem: 'not-hippo' }
  if (file.status < 200 || file.status >= 300) return { ok: false, problem: 'unreachable' }
  const info = parseSiteInfo(file.body)
  if (info === 'incompatible') return { ok: false, problem: 'incompatible' }
  if (!info) return { ok: false, problem: 'not-hippo' }
  return { ok: true, url: n.url, host: new URL(file.url).host, info }
}

/** One plain sentence per problem, for under the field. */
export function siteProblemText(p: SiteProblem): string {
  switch (p) {
    case 'invalid-address':
      return 'That is not a web address Hippo can use. Enter it like gifts.example.org.'
    case 'not-https':
      return 'The address must be secure (https). Hippo cannot use an http address.'
    case 'unreachable':
      return 'Hippo could not reach that address. Check it, or try again when you are online.'
    case 'not-hippo':
      return 'That address answers, but it is not a Hippo website.'
    case 'incompatible':
      return 'That Hippo website runs a different version that this app cannot work with.'
  }
}

/** Relays to use after choosing a site: the site's, unless the person set their own. Pure, for tests. */
export function relaysAfterSiteChange(current: readonly string[] | undefined, previouslyAdopted: readonly string[] | undefined, site: readonly string[], defaults: readonly string[]): { relays: string[] | undefined; adopted: string[] | undefined } | 'keep' {
  const same = (a: readonly string[] | undefined, b: readonly string[] | undefined) => !!a && !!b && a.length === b.length && a.every((r, i) => r === b[i])
  const own = current !== undefined && !same(current, previouslyAdopted)
  if (own) return 'keep'
  const isDefault = site.length === defaults.length && site.every((r) => defaults.includes(r))
  return isDefault ? { relays: undefined, adopted: undefined } : { relays: [...site], adopted: [...site] }
}
