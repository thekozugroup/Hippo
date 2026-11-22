// Opt-in link preview lookup. A static site cannot read another site's page,
// so for a wish added from a pasted link there is no title or picture. When
// the user has turned this on, the cleaned link is sent to one third-party
// service (Microlink) that fetches the page and returns its metadata.
//
// Everything that comes back is untrusted: it is size-capped, parsed
// defensively, validated with the same limits as other input, and returned as
// a patch that the caller merges without overwriting what the user typed.
// Nothing here throws.

import type { HippoDb } from '../db/schema.ts'
import { isSafeHttpUrl } from '../model/guards.ts'
import { LIMITS } from '../model/limits.ts'
import { isPublicHostname } from '../model/validate.ts'
import type { Money } from '../model/types.ts'
import { parsePrice, stripTrackingParams } from './capture.ts'

/** Settings table key. Stored value is the boolean `true` when the user opted in; anything else means off. */
export const LINK_PREVIEW_SETTING_KEY = 'linkPreview'
/** The only host the app contacts for previews (also the only entry this adds to connect-src in vite.config.ts). */
export const LINK_PREVIEW_HOST = 'api.microlink.io'
export const LINK_PREVIEW_SERVICE_NAME = 'Microlink'
/** The UI must show this sentence next to the toggle, unchanged. */
export const LINK_PREVIEW_DISCLOSURE =
  'Hippo will send each link you add to Microlink (api.microlink.io), a third-party service, so it can look up the page\'s title and picture. Nothing else is sent.'

const ENDPOINT = `https://${LINK_PREVIEW_HOST}/`
const DEFAULT_TIMEOUT_MS = 6000
/** Largest response body read, in bytes. */
const MAX_BODY_BYTES = 256 * 1024

export async function getLinkPreviewEnabled(db: HippoDb): Promise<boolean> {
  try {
    return (await db.settings.get(LINK_PREVIEW_SETTING_KEY))?.value === true
  } catch {
    return false
  }
}

export async function setLinkPreviewEnabled(db: HippoDb, enabled: boolean): Promise<void> {
  if (enabled) await db.settings.put({ key: LINK_PREVIEW_SETTING_KEY, value: true })
  else await db.settings.delete(LINK_PREVIEW_SETTING_KEY)
}

/** Fields a lookup may fill. Every field is optional and already validated. */
export interface LinkPreviewPatch {
  title?: string
  imageUrl?: string
  price?: Money
}

export type LinkPreviewFailure = 'timeout' | 'network' | 'rate-limited' | 'service-error' | 'bad-response'

export type LinkPreviewResult =
  | { kind: 'found'; patch: LinkPreviewPatch }
  | { kind: 'nothing-found' }
  | { kind: 'failed'; reason: LinkPreviewFailure }
  /** The opt-in setting is off. Nothing was sent. */
  | { kind: 'disabled' }
  /** Not an https URL with a public host. Nothing was sent. */
  | { kind: 'invalid-url' }
  /** The caller aborted (`signal`); the request, if one was running, was stopped. */
  | { kind: 'cancelled' }

export interface LinkPreviewDeps {
  db: HippoDb
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch
  timeoutMs?: number
  /** Aborting it stops the request (for example when the link in the form changes). */
  signal?: AbortSignal
}

class Cancelled extends Error {}

/**
 * The URL that would be sent: https only, public host, no credentials,
 * tracking parameters and the fragment removed. `undefined` when the link
 * must not be sent at all.
 */
export function previewRequestUrl(url: string): string | undefined {
  if (typeof url !== 'string' || url.length === 0 || url.length > LIMITS.url) return undefined
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return undefined
  }
  if (u.protocol !== 'https:' || u.username || u.password || !isPublicHostname(u.hostname)) return undefined
  u.hash = ''
  const cleaned = stripTrackingParams(u.href)
  return cleaned.length <= LIMITS.url ? cleaned : undefined
}

/** The exact request URL for a cleaned link. Only `url` is sent. */
export function previewServiceRequest(cleanedUrl: string): string {
  return `${ENDPOINT}?url=${encodeURIComponent(cleanedUrl)}`
}

// Titles that anti-bot pages return instead of the real page.
const BLOCK_PAGE_TITLES = /^(just a moment|access denied|attention required|robot check|are you a robot|captcha|403 forbidden|404|page not found|error|blocked|verify you are human)/i

function cleanTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  // Control characters and bidi overrides have no place in a title.
  const flat = value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim()
  if (flat.length === 0 || BLOCK_PAGE_TITLES.test(flat)) return undefined
  const cps = Array.from(flat)
  return cps.length > LIMITS.title ? cps.slice(0, LIMITS.title).join('').trim() : flat
}

function cleanImageUrl(value: unknown): string | undefined {
  const raw = typeof value === 'string' ? value : isRecord(value) && typeof value.url === 'string' ? value.url : undefined
  if (raw === undefined || raw.length === 0 || raw.length > LIMITS.url) return undefined
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' || u.username || u.password || !isSafeHttpUrl(u.href)) return undefined
    return u.href.length <= LIMITS.url ? u.href : undefined
  } catch {
    return undefined
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function cleanPrice(price: unknown, currency: unknown): Money | undefined {
  if (typeof currency !== 'string') return undefined
  const text = typeof price === 'number' && Number.isFinite(price) ? String(price) : typeof price === 'string' ? price : undefined
  if (text === undefined) return undefined
  return parsePrice(text, currency)
}

/** Validates a parsed response body. Exported for tests; takes any value. */
export function patchFromServiceResponse(body: unknown): LinkPreviewPatch | undefined {
  if (!isRecord(body) || body.status !== 'success' || !isRecord(body.data)) return undefined
  const data = body.data
  const patch: LinkPreviewPatch = {}
  const title = cleanTitle(data.title)
  if (title) patch.title = title
  const imageUrl = cleanImageUrl(data.image)
  if (imageUrl) patch.imageUrl = imageUrl
  const price = cleanPrice(data.price, data.currency)
  if (price) patch.price = price
  return Object.keys(patch).length > 0 ? patch : undefined
}

async function readCapped(res: Response): Promise<string | undefined> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return undefined
  if (!res.body) {
    const text = await res.text()
    return text.length > MAX_BODY_BYTES ? undefined : text
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined)
      return undefined
    }
    chunks.push(value)
  }
  const all = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    all.set(c, offset)
    offset += c.byteLength
  }
  return new TextDecoder('utf-8').decode(all)
}

class Timeout extends Error {}

/**
 * Looks up title, picture and (when the service supplies one) price for a
 * link. Does nothing unless the user opted in. Sends only the cleaned URL.
 * Never throws; every outcome is a result value.
 */
export async function lookupLinkPreview(url: string, deps: LinkPreviewDeps): Promise<LinkPreviewResult> {
  try {
    if (deps.signal?.aborted) return { kind: 'cancelled' }
    if (!(await getLinkPreviewEnabled(deps.db))) return { kind: 'disabled' }
    if (deps.signal?.aborted) return { kind: 'cancelled' }
    const cleaned = previewRequestUrl(url)
    if (cleaned === undefined) return { kind: 'invalid-url' }
    const doFetch = deps.fetch ?? globalThis.fetch
    if (typeof doFetch !== 'function') return { kind: 'failed', reason: 'network' }
    const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new Timeout())
      }, timeoutMs)
    })
    const onAbort = (): void => controller.abort()
    deps.signal?.addEventListener('abort', onAbort, { once: true })
    const cancelled = new Promise<never>((_, reject) => {
      deps.signal?.addEventListener('abort', () => reject(new Cancelled()), { once: true })
    })
    cancelled.catch(() => undefined)
    const work = (async (): Promise<LinkPreviewResult> => {
      const res = await doFetch(previewServiceRequest(cleaned), {
        method: 'GET',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
        signal: controller.signal,
      })
      if (res.status === 429) return { kind: 'failed', reason: 'rate-limited' }
      if (!res.ok) {
        // The service answers an unreachable or unreadable page with 4xx and a JSON body; treat that as nothing found.
        if (res.status === 404 || res.status === 422) return { kind: 'nothing-found' }
        return { kind: 'failed', reason: 'service-error' }
      }
      const text = await readCapped(res)
      if (text === undefined) return { kind: 'failed', reason: 'bad-response' }
      let body: unknown
      try {
        body = JSON.parse(text)
      } catch {
        return { kind: 'failed', reason: 'bad-response' }
      }
      if (!isRecord(body)) return { kind: 'failed', reason: 'bad-response' }
      if (body.status === 'fail') return body.code === 'ERATE' ? { kind: 'failed', reason: 'rate-limited' } : { kind: 'nothing-found' }
      if (body.status !== 'success') return { kind: 'failed', reason: 'bad-response' }
      const patch = patchFromServiceResponse(body)
      return patch ? { kind: 'found', patch } : { kind: 'nothing-found' }
    })()
    work.catch(() => undefined) // a late rejection after the timeout is expected
    try {
      return await Promise.race([work, timeout, cancelled])
    } finally {
      clearTimeout(timer)
      deps.signal?.removeEventListener('abort', onAbort)
    }
  } catch (e) {
    if (e instanceof Cancelled || deps.signal?.aborted) return { kind: 'cancelled' }
    return { kind: 'failed', reason: e instanceof Timeout ? 'timeout' : 'network' }
  }
}

/** What the caller already has in the form. Empty or absent means "not typed by the user". */
export interface LinkPreviewCurrent {
  title?: string | undefined
  imageUrl?: string | undefined
  price?: Money | undefined
}

/**
 * Returns only the parts of `patch` that fill empty fields of `current`.
 * Pass a blank title when the current one is just a guess from the URL.
 */
export function fillEmptyFields(current: LinkPreviewCurrent, patch: LinkPreviewPatch): LinkPreviewPatch {
  const out: LinkPreviewPatch = {}
  if (patch.title !== undefined && !(current.title ?? '').trim()) out.title = patch.title
  if (patch.imageUrl !== undefined && !current.imageUrl) out.imageUrl = patch.imageUrl
  if (patch.price !== undefined && !current.price) out.price = patch.price
  return out
}
