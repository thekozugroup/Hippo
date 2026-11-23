import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb, type HippoDb } from '../db/schema.ts'
import { randomId } from '../crypto/bytes.ts'
import { LIMITS } from '../model/limits.ts'
import {
  BASE_ELEMENT,
  BLOCK_PAGE,
  BOTH,
  COMMA_DECIMALS,
  COMMA_DECIMALS_LD,
  HOSTILE,
  JSON_LD_ONLY,
  largePage,
  NOTHING,
  OG_ONLY,
  PROTOCOL_RELATIVE_IMAGE,
  RELATIVE_IMAGES,
} from '../testing/page-fixtures.ts'
import {
  getPageLookupEnabled,
  isAcceptablePageUrl,
  lookupPageOnDevice,
  metadataFromHtml,
  PAGE_LOOKUP_DISCLOSURE,
  PAGE_LOOKUP_SETTING_KEY,
  PAGE_MAX_BYTES,
  PageFetchError,
  setPageLookupEnabled,
  type FetchedPage,
  type PageFetcher,
} from './page-metadata.ts'

const PAGE = 'https://shop.example/p/item'

describe('metadataFromHtml: page shapes', () => {
  it('reads Open Graph and product meta tags', () => {
    expect(metadataFromHtml(OG_ONLY, PAGE)).toEqual({
      title: 'Red wool scarf',
      imageUrl: 'https://cdn.knit.example/scarf-1200.jpg',
      price: { amount: 2450, currency: 'GBP' },
    })
  })

  it('reads JSON-LD Product and Offer data inside @graph, with arrays', () => {
    expect(metadataFromHtml(JSON_LD_ONLY, PAGE)).toEqual({
      title: 'Trail running shoes',
      imageUrl: 'https://img.bigstore.example/shoe-a.jpg',
      price: { amount: 11900, currency: 'USD' },
    })
  })

  it('with both, prefers the JSON-LD name and price and the og:image picture', () => {
    expect(metadataFromHtml(BOTH, PAGE)).toEqual({
      title: 'Ceramic teapot',
      imageUrl: 'https://home.example/og/teapot.jpg',
      price: { amount: 3990, currency: 'EUR' },
    })
  })

  it('reads prices with a decimal comma and thousands dots', () => {
    expect(metadataFromHtml(COMMA_DECIMALS, PAGE)?.price).toEqual({ amount: 129900, currency: 'EUR' })
    expect(metadataFromHtml(COMMA_DECIMALS_LD, PAGE)).toEqual({ title: 'Kaffeemühle', price: { amount: 8995, currency: 'EUR' } })
  })

  it('resolves relative and protocol-relative pictures against the page, and honours an https <base>', () => {
    expect(metadataFromHtml(RELATIVE_IMAGES, 'https://toys.example/trains/set-1')?.imageUrl).toBe('https://toys.example/media/train.jpg')
    expect(metadataFromHtml(PROTOCOL_RELATIVE_IMAGE, PAGE)).toEqual({ title: 'Kite', imageUrl: 'https://images.kites.example/kite.png' })
    expect(metadataFromHtml(BASE_ELEMENT, PAGE)?.imageUrl).toBe('https://static.toys.example/shop/img/puzzle.jpg')
  })

  it('returns nothing for a page without metadata or an anti-bot page', () => {
    expect(metadataFromHtml(NOTHING, PAGE)).toBeUndefined()
    expect(metadataFromHtml(BLOCK_PAGE, PAGE)).toBeUndefined()
    expect(metadataFromHtml('', PAGE)).toBeUndefined()
  })

  it('treats every value as hostile: no markup runs, unsafe pictures and zero or negative prices are dropped', () => {
    const before = document.body.innerHTML
    const patch = metadataFromHtml(HOSTILE, PAGE)
    // The title is plain text with the bidi override removed; it never becomes markup.
    expect(patch?.title).toBe('<img src=x onerror=alert(1)> Lamp')
    expect(patch?.imageUrl).toBeUndefined()
    expect(patch?.price).toBeUndefined()
    expect((window as { __pwned?: boolean }).__pwned).toBeUndefined()
    expect(document.body.innerHTML).toBe(before)
  })

  it('cuts titles and refuses over-long picture addresses', () => {
    const long = 'x'.repeat(LIMITS.title + 50)
    const html = `<meta property="og:title" content="${long}"><meta property="og:image" content="https://a.example/${'p'.repeat(LIMITS.url)}.jpg">`
    const patch = metadataFromHtml(html, PAGE)
    expect(Array.from(patch?.title ?? '').length).toBe(LIMITS.title)
    expect(patch?.imageUrl).toBeUndefined()
  })

  it('reads a very large page up to the cap and still finds the metadata in its head', () => {
    const html = largePage(4)
    expect(html.length).toBeGreaterThan(PAGE_MAX_BYTES)
    const parse = vi.fn((s: string) => new DOMParser().parseFromString(s, 'text/html'))
    expect(metadataFromHtml(html, PAGE, parse)).toEqual({ title: 'Big page product', imageUrl: 'https://big.example/p.jpg' })
    expect(parse.mock.calls[0]?.[0].length).toBe(PAGE_MAX_BYTES)
  })
})

describe('isAcceptablePageUrl', () => {
  it('accepts https public hosts only', () => {
    expect(isAcceptablePageUrl('https://shop.example/a')).toBe(true)
    for (const bad of ['http://shop.example/a', 'https://localhost/a', 'https://10.0.0.1/', 'https://192.168.1.1/', 'https://printer.local/', 'https://u:p@shop.example/', 'https://[::1]/', 'not a url']) {
      expect(isAcceptablePageUrl(bad), bad).toBe(false)
    }
  })
})

describe('lookupPageOnDevice', () => {
  let db: HippoDb
  beforeEach(async () => {
    db = openDb(`hippo-test-${randomId()}`)
    await db.open()
  })
  afterEach(() => {
    db.close()
    vi.useRealTimers()
  })

  const page = (over: Partial<FetchedPage> = {}): FetchedPage => ({ status: 200, url: PAGE, contentType: 'text/html; charset=utf-8', body: OG_ONLY, ...over })
  const fetcher = (result: FetchedPage | Error | (() => Promise<FetchedPage>)) =>
    vi.fn<PageFetcher>(async () => {
      if (typeof result === 'function') return result()
      if (result instanceof Error) throw result
      return result
    })

  it('is on by default, can be turned off, and says so in one sentence', async () => {
    expect(await getPageLookupEnabled(db)).toBe(true)
    await setPageLookupEnabled(db, false)
    expect(await getPageLookupEnabled(db)).toBe(false)
    expect((await db.settings.get(PAGE_LOOKUP_SETTING_KEY))?.value).toBe(false)
    await setPageLookupEnabled(db, true)
    expect(await db.settings.get(PAGE_LOOKUP_SETTING_KEY)).toBeUndefined()
    expect(PAGE_LOOKUP_DISCLOSURE).toBe('Hippo opens the shop page from your phone to read its name, picture and price; nothing is sent to anyone else.')
  })

  it('finds the name, picture and price, fetching the cleaned link with the size cap', async () => {
    const fetchPage = fetcher(page())
    const r = await lookupPageOnDevice('https://shop.example/p/item?utm_source=x&id=7#reviews', { db, fetchPage })
    expect(r).toEqual({ kind: 'found', patch: { title: 'Red wool scarf', imageUrl: 'https://cdn.knit.example/scarf-1200.jpg', price: { amount: 2450, currency: 'GBP' } } })
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(fetchPage.mock.calls[0]?.[0]).toBe('https://shop.example/p/item?id=7')
    expect(fetchPage.mock.calls[0]?.[1]).toEqual({ timeoutMs: expect.any(Number), maxBytes: PAGE_MAX_BYTES })
  })

  it('sends nothing when turned off, or for links that are not https to a public host', async () => {
    const fetchPage = fetcher(page())
    await setPageLookupEnabled(db, false)
    expect(await lookupPageOnDevice('https://shop.example/a', { db, fetchPage })).toEqual({ kind: 'disabled' })
    await setPageLookupEnabled(db, true)
    for (const url of ['http://shop.example/a', 'https://localhost:8080/admin', 'https://192.168.0.1/', 'https://router.lan/', 'ftp://x.example/']) {
      expect(await lookupPageOnDevice(url, { db, fetchPage }), url).toEqual({ kind: 'invalid-url' })
    }
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('checks the address again after redirects', async () => {
    for (const url of ['https://10.0.0.5/admin', 'http://shop.example/p', 'https://metadata.internal/']) {
      expect(await lookupPageOnDevice(PAGE, { db, fetchPage: fetcher(page({ url })) }), url).toEqual({ kind: 'invalid-url' })
    }
  })

  it('ignores non-HTML answers and error pages', async () => {
    expect(await lookupPageOnDevice(PAGE, { db, fetchPage: fetcher(page({ contentType: 'application/json', body: '{"title":"x"}' })) })).toEqual({ kind: 'nothing-found' })
    expect(await lookupPageOnDevice(PAGE, { db, fetchPage: fetcher(page({ contentType: 'image/jpeg', body: '' })) })).toEqual({ kind: 'nothing-found' })
    expect(await lookupPageOnDevice(PAGE, { db, fetchPage: fetcher(page({ status: 404 })) })).toEqual({ kind: 'nothing-found' })
    expect(await lookupPageOnDevice(PAGE, { db, fetchPage: fetcher(page({ status: 503 })) })).toEqual({ kind: 'failed', reason: 'service-error' })
    expect(await lookupPageOnDevice(PAGE, { db, fetchPage: fetcher(page({ status: 429 })) })).toEqual({ kind: 'failed', reason: 'rate-limited' })
    expect(await lookupPageOnDevice(PAGE, { db, fetchPage: fetcher(page({ body: NOTHING })) })).toEqual({ kind: 'nothing-found' })
  })

  it('rejects malformed answers from the bridge', async () => {
    const bad = { status: '200', url: PAGE, contentType: 'text/html', body: OG_ONLY } as unknown as FetchedPage
    expect(await lookupPageOnDevice(PAGE, { db, fetchPage: fetcher(bad) })).toEqual({ kind: 'failed', reason: 'bad-response' })
  })

  it('maps native failures', async () => {
    expect(await lookupPageOnDevice(PAGE, { db, fetchPage: fetcher(new PageFetchError('blocked')) })).toEqual({ kind: 'invalid-url' })
    expect(await lookupPageOnDevice(PAGE, { db, fetchPage: fetcher(new PageFetchError('timeout')) })).toEqual({ kind: 'failed', reason: 'timeout' })
    expect(await lookupPageOnDevice(PAGE, { db, fetchPage: fetcher(new PageFetchError('network')) })).toEqual({ kind: 'failed', reason: 'network' })
    expect(await lookupPageOnDevice(PAGE, { db, fetchPage: fetcher(new Error('boom')) })).toEqual({ kind: 'failed', reason: 'network' })
  })

  it('times out on its own when the bridge never answers', async () => {
    vi.useFakeTimers()
    const pending = lookupPageOnDevice(PAGE, { db, timeoutMs: 1000, fetchPage: fetcher(() => new Promise<FetchedPage>(() => undefined)) })
    await vi.advanceTimersByTimeAsync(2000)
    expect(await pending).toEqual({ kind: 'failed', reason: 'timeout' })
  })

  it('is cancelled when the link changes (the signal aborts), and drops a late answer', async () => {
    const controller = new AbortController()
    let answer: (p: FetchedPage) => void = () => undefined
    const pending = lookupPageOnDevice(PAGE, { db, signal: controller.signal, fetchPage: fetcher(() => new Promise<FetchedPage>((r) => (answer = r))) })
    await new Promise((r) => setTimeout(r, 10))
    controller.abort()
    answer(page())
    expect(await pending).toEqual({ kind: 'cancelled' })
    const before = new AbortController()
    before.abort()
    expect(await lookupPageOnDevice(PAGE, { db, signal: before.signal, fetchPage: fetcher(page()) })).toEqual({ kind: 'cancelled' })
  })
})
