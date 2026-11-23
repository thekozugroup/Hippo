// Reading a shop page on the device (Android app only). The app fetches the
// page itself, through a small native method that has no CORS limit, sends no
// cookies, caps the size and checks every redirect (android/.../PageFetch*),
// and this module turns the answer into a patch for the wish form.
//
// Everything about the page is hostile: its address after redirects, its
// type, its size, and every byte of its HTML. The HTML is parsed with
// DOMParser into an inert document (no scripts run, nothing loads) that is
// never put into the page, only these values are read, and each one is
// validated with the same limits as any other input. Nothing here throws.

import type { HippoDb } from '../db/schema.ts'
import { isPublicHostname } from '../model/validate.ts'
import type { Money } from '../model/types.ts'
import { parsePrice } from './capture.ts'
import { cleanImageUrl, cleanTitle, previewRequestUrl, type LinkPreviewPatch, type LinkPreviewResult } from './link-preview.ts'

/** Settings table key. Absent means on (the default in the app); the boolean `false` means the person turned it off. */
export const PAGE_LOOKUP_SETTING_KEY = 'pageLookup'
/** The Settings switch must show this sentence, unchanged. */
export const PAGE_LOOKUP_DISCLOSURE = 'Hippo opens the shop page from your phone to read its name, picture and price; nothing is sent to anyone else.'

/** Largest part of a page that is read and parsed, in bytes (the native side stops reading here). */
export const PAGE_MAX_BYTES = 1_500_000
/** Whole request, redirects included. */
export const PAGE_TIMEOUT_MS = 8_000
/** JSON-LD blocks larger than this are skipped, and at most this many are read. */
const MAX_JSON_LD_CHARS = 300_000
const MAX_JSON_LD_BLOCKS = 20
/** How deep and how many nodes the JSON-LD walk visits. */
const MAX_JSON_DEPTH = 8
const MAX_JSON_NODES = 2_000

export async function getPageLookupEnabled(db: HippoDb): Promise<boolean> {
  try {
    return (await db.settings.get(PAGE_LOOKUP_SETTING_KEY))?.value !== false
  } catch {
    return true
  }
}

export async function setPageLookupEnabled(db: HippoDb, enabled: boolean): Promise<void> {
  if (enabled) await db.settings.delete(PAGE_LOOKUP_SETTING_KEY)
  else await db.settings.put({ key: PAGE_LOOKUP_SETTING_KEY, value: false })
}

/** What the native fetch returns. `url` is the address after redirects. */
export interface FetchedPage {
  status: number
  url: string
  contentType: string
  body: string
  /** The page was longer than the cap and was cut. */
  truncated?: boolean
}

/** Why a fetch was refused or failed, as the native side reports it. */
export type PageFetchErrorCode = 'blocked' | 'timeout' | 'network'

export class PageFetchError extends Error {
  readonly code: PageFetchErrorCode
  constructor(code: PageFetchErrorCode) {
    super(code)
    this.name = 'PageFetchError'
    this.code = code
  }
}

export type PageFetcher = (url: string, options: { timeoutMs: number; maxBytes: number }) => Promise<FetchedPage>

export interface PageLookupDeps {
  db: HippoDb
  fetchPage: PageFetcher
  /** Defaults to the global DOMParser. */
  parseHtml?: (html: string) => Document
  timeoutMs?: number
  /** Aborting it drops the answer (for example when the link in the form changes). */
  signal?: AbortSignal
}

// ---------------------------------------------------------------- parsing

type Json = unknown

function isRecord(v: Json): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function types(node: Record<string, Json>): string[] {
  const t = node['@type']
  const list = Array.isArray(t) ? t : [t]
  return list.filter((x): x is string => typeof x === 'string').map((x) => x.replace(/^https?:\/\/schema\.org\//i, '').toLowerCase())
}

/** Every object in the JSON-LD whose @type includes Product (also inside arrays, @graph and nested values), breadth first, bounded. */
function findProducts(root: Json): Record<string, Json>[] {
  const out: Record<string, Json>[] = []
  const queue: Array<{ v: Json; depth: number }> = [{ v: root, depth: 0 }]
  let visited = 0
  while (queue.length > 0 && visited < MAX_JSON_NODES && out.length < 10) {
    const next = queue.shift()
    if (!next) break
    visited++
    const { v, depth } = next
    if (depth > MAX_JSON_DEPTH) continue
    if (Array.isArray(v)) {
      for (const x of v.slice(0, 200)) queue.push({ v: x, depth: depth + 1 })
      continue
    }
    if (!isRecord(v)) continue
    if (types(v).some((t) => t === 'product' || t === 'productgroup' || t === 'individualproduct')) out.push(v)
    for (const [k, x] of Object.entries(v)) {
      if (k === '@context') continue
      if (typeof x === 'object' && x !== null) queue.push({ v: x, depth: depth + 1 })
    }
  }
  return out
}

function firstString(v: Json): string | undefined {
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (Array.isArray(v)) {
    for (const x of v.slice(0, 20)) {
      const s = firstString(x)
      if (s !== undefined) return s
    }
  }
  return undefined
}

function imageOf(v: Json): string | undefined {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) {
    for (const x of v.slice(0, 20)) {
      const s = imageOf(x)
      if (s !== undefined) return s
    }
    return undefined
  }
  if (isRecord(v)) return firstString(v.url) ?? firstString(v.contentUrl)
  return undefined
}

/** A positive price; a zero price on a shop page is almost always a placeholder. */
function money(price: Json, currency: Json): Money | undefined {
  const p = typeof price === 'number' && Number.isFinite(price) ? String(price) : firstString(price)
  const c = firstString(currency)?.trim().toUpperCase()
  if (p === undefined || c === undefined) return undefined
  const m = parsePrice(p.trim(), c)
  return m && m.amount > 0 ? m : undefined
}

function priceOfOffer(offer: Json, depth = 0): Money | undefined {
  if (depth > 3) return undefined
  if (Array.isArray(offer)) {
    for (const o of offer.slice(0, 20)) {
      const m = priceOfOffer(o, depth + 1)
      if (m) return m
    }
    return undefined
  }
  if (!isRecord(offer)) return undefined
  const currency = offer.priceCurrency
  return (
    money(offer.price, currency) ??
    money(offer.lowPrice, currency) ??
    priceOfOffer(offer.priceSpecification, depth + 1) ??
    (isRecord(offer.priceSpecification) ? money(offer.priceSpecification.price, offer.priceSpecification.priceCurrency ?? currency) : undefined) ??
    priceOfOffer(offer.offers, depth + 1)
  )
}

interface Found {
  title?: string
  image?: string
  price?: Money
}

function fromJsonLd(doc: Document): Found {
  const found: Found = {}
  const scripts = Array.from(doc.querySelectorAll('script[type]')).filter((s) => /^application\/ld\+json\b/i.test(s.getAttribute('type') ?? ''))
  for (const script of scripts.slice(0, MAX_JSON_LD_BLOCKS)) {
    const text = script.textContent ?? ''
    if (text.length > MAX_JSON_LD_CHARS) continue
    let data: Json
    try {
      data = JSON.parse(text)
    } catch {
      continue
    }
    for (const product of findProducts(data)) {
      found.title ??= firstString(product.name)
      found.image ??= imageOf(product.image)
      found.price ??= priceOfOffer(product.offers)
      if (found.title && found.image && found.price) return found
    }
  }
  return found
}

function meta(doc: Document, ...keys: string[]): string | undefined {
  for (const key of keys) {
    for (const attr of ['property', 'name', 'itemprop']) {
      for (const el of Array.from(doc.querySelectorAll(`meta[${attr}]`))) {
        if ((el.getAttribute(attr) ?? '').toLowerCase() !== key) continue
        const v = el.getAttribute('content')
        if (v && v.trim()) return v.trim()
      }
    }
  }
  return undefined
}

/** Resolves a possibly relative picture address against the page (or its <base>, when that is https). */
function absolute(raw: string | undefined, pageUrl: string, doc: Document): string | undefined {
  if (!raw) return undefined
  let base = pageUrl
  const baseHref = doc.querySelector('base[href]')?.getAttribute('href')
  if (baseHref) {
    try {
      const b = new URL(baseHref, pageUrl)
      if (b.protocol === 'https:') base = b.href
    } catch {
      // keep the page address
    }
  }
  try {
    return new URL(raw.trim(), base).href
  } catch {
    return undefined
  }
}

function defaultParse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

/**
 * The name, picture and price a shop page declares: JSON-LD `Product` and `Offer` data, Open Graph
 * and product meta tags, then the page title. Returns only validated values, or undefined when
 * nothing usable is there. `pageUrl` is the page's address after redirects (for relative pictures).
 */
export function metadataFromHtml(html: string, pageUrl: string, parseHtml: (html: string) => Document = defaultParse): LinkPreviewPatch | undefined {
  if (typeof html !== 'string' || html.length === 0) return undefined
  let doc: Document
  try {
    doc = parseHtml(html.length > PAGE_MAX_BYTES ? html.slice(0, PAGE_MAX_BYTES) : html)
  } catch {
    return undefined
  }
  const ld = fromJsonLd(doc)
  const patch: LinkPreviewPatch = {}

  const title = [ld.title, meta(doc, 'og:title'), meta(doc, 'twitter:title'), doc.querySelector('title')?.textContent ?? undefined]
    .map((t) => cleanTitle(t))
    .find((t) => t !== undefined)
  if (title) patch.title = title

  const imageCandidates = [
    meta(doc, 'og:image:secure_url'),
    meta(doc, 'og:image'),
    meta(doc, 'og:image:url'),
    ld.image,
    meta(doc, 'twitter:image', 'twitter:image:src'),
    doc.querySelector('link[rel="image_src"]')?.getAttribute('href') ?? undefined,
  ]
  for (const raw of imageCandidates) {
    const img = cleanImageUrl(absolute(raw, pageUrl, doc))
    if (img) {
      patch.imageUrl = img
      break
    }
  }

  const price =
    ld.price ??
    money(meta(doc, 'product:price:amount'), meta(doc, 'product:price:currency')) ??
    money(meta(doc, 'og:price:amount'), meta(doc, 'og:price:currency')) ??
    money(meta(doc, 'price'), meta(doc, 'pricecurrency'))
  if (price) patch.price = price

  return Object.keys(patch).length > 0 ? patch : undefined
}

// ---------------------------------------------------------------- lookup

const HTML_TYPES = /^(text\/html|application\/xhtml\+xml)\b/i

class Timeout extends Error {}
class Cancelled extends Error {}

/** True for a final page address that may be used: https, no credentials, a public host. */
export function isAcceptablePageUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && !u.username && !u.password && isPublicHostname(u.hostname)
  } catch {
    return false
  }
}

/**
 * Reads the name, picture and price of a shop page from the device. Does nothing when the person
 * turned it off. Only https links to public hosts are fetched, with tracking parameters and the
 * fragment removed; the address after redirects is checked again. Never throws.
 */
export async function lookupPageOnDevice(url: string, deps: PageLookupDeps): Promise<LinkPreviewResult> {
  const { signal } = deps
  try {
    if (signal?.aborted) return { kind: 'cancelled' }
    if (!(await getPageLookupEnabled(deps.db))) return { kind: 'disabled' }
    if (signal?.aborted) return { kind: 'cancelled' }
    const cleaned = previewRequestUrl(url)
    if (cleaned === undefined) return { kind: 'invalid-url' }

    const timeoutMs = deps.timeoutMs ?? PAGE_TIMEOUT_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Timeout()), timeoutMs + 500)
    })
    let onAbort: (() => void) | undefined
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Cancelled())
      signal?.addEventListener('abort', onAbort, { once: true })
    })
    cancelled.catch(() => undefined)
    timeout.catch(() => undefined)
    const work = deps.fetchPage(cleaned, { timeoutMs, maxBytes: PAGE_MAX_BYTES })
    work.catch(() => undefined) // an answer after a timeout or cancel is dropped
    let page: FetchedPage
    try {
      page = await Promise.race([work, timeout, cancelled])
    } finally {
      clearTimeout(timer)
      if (onAbort) signal?.removeEventListener('abort', onAbort)
    }

    if (!isRecord(page) || typeof page.url !== 'string' || typeof page.status !== 'number' || typeof page.body !== 'string') return { kind: 'failed', reason: 'bad-response' }
    if (!isAcceptablePageUrl(page.url)) return { kind: 'invalid-url' }
    if (page.status === 429) return { kind: 'failed', reason: 'rate-limited' }
    if (page.status >= 500) return { kind: 'failed', reason: 'service-error' }
    if (page.status < 200 || page.status >= 300) return { kind: 'nothing-found' }
    if (!HTML_TYPES.test(typeof page.contentType === 'string' ? page.contentType.trim() : '')) return { kind: 'nothing-found' }
    const patch = metadataFromHtml(page.body, page.url, deps.parseHtml)
    return patch ? { kind: 'found', patch } : { kind: 'nothing-found' }
  } catch (e) {
    if (e instanceof Cancelled || signal?.aborted) return { kind: 'cancelled' }
    if (e instanceof Timeout) return { kind: 'failed', reason: 'timeout' }
    if (e instanceof PageFetchError) {
      if (e.code === 'blocked') return { kind: 'invalid-url' }
      return { kind: 'failed', reason: e.code === 'timeout' ? 'timeout' : 'network' }
    }
    return { kind: 'failed', reason: 'network' }
  }
}
