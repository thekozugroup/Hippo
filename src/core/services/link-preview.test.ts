import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb, type HippoDb } from '../db/schema.ts'
import { randomId } from '../crypto/bytes.ts'
import {
  fillEmptyFields,
  getLinkPreviewEnabled,
  LINK_PREVIEW_DISCLOSURE,
  LINK_PREVIEW_HOST,
  lookupLinkPreview,
  patchFromServiceResponse,
  previewRequestUrl,
  setLinkPreviewEnabled,
} from './link-preview.ts'

let db: HippoDb
beforeEach(async () => {
  db = openDb(`hippo-test-${randomId()}`)
  await db.open()
})
afterEach(() => {
  db.close()
  vi.useRealTimers()
})

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, ...init })
}
const okBody = (data: Record<string, unknown>): unknown => ({ status: 'success', data })

function mockFetch(res: Response | (() => Response | Promise<Response>)): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(() => Promise.resolve(typeof res === 'function' ? res() : res))
}

describe('opt-in setting', () => {
  it('is off by default and round-trips', async () => {
    expect(await getLinkPreviewEnabled(db)).toBe(false)
    await setLinkPreviewEnabled(db, true)
    expect(await getLinkPreviewEnabled(db)).toBe(true)
    await setLinkPreviewEnabled(db, false)
    expect(await getLinkPreviewEnabled(db)).toBe(false)
  })

  it('treats a stored non-true value as off', async () => {
    await db.settings.put({ key: 'linkPreview', value: 'true' })
    expect(await getLinkPreviewEnabled(db)).toBe(false)
  })

  it('names the service in the disclosure sentence', () => {
    expect(LINK_PREVIEW_DISCLOSURE).toContain(LINK_PREVIEW_HOST)
  })
})

describe('lookupLinkPreview gate and URL handling', () => {
  it('does not call the network when the setting is off', async () => {
    const f = mockFetch(jsonResponse(okBody({ title: 'x' })))
    expect(await lookupLinkPreview('https://shop.example/p/1', { db, fetch: f })).toEqual({ kind: 'disabled' })
    expect(f).not.toHaveBeenCalled()
  })

  it.each([
    'http://shop.example/p/1',
    'ftp://shop.example/x',
    'javascript:alert(1)',
    'not a url',
    '',
    'https://user:pw@shop.example/',
    'https://localhost/x',
    'https://192.168.1.10/x',
    'https://intranet/x',
    'https://' + 'a'.repeat(2100) + '.example/',
  ])('refuses %s without sending anything', async (url) => {
    await setLinkPreviewEnabled(db, true)
    const f = mockFetch(jsonResponse(okBody({ title: 'x' })))
    expect(await lookupLinkPreview(url, { db, fetch: f })).toEqual({ kind: 'invalid-url' })
    expect(f).not.toHaveBeenCalled()
  })

  it('sends one GET with only the cleaned URL', async () => {
    await setLinkPreviewEnabled(db, true)
    const f = mockFetch(jsonResponse(okBody({ title: 'Red scarf' })))
    await lookupLinkPreview('https://shop.example/p/1?id=7&utm_source=mail&fbclid=abc#:~:text=hi', { db, fetch: f })
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0] ?? []
    expect(url).toBe(`https://${LINK_PREVIEW_HOST}/?url=${encodeURIComponent('https://shop.example/p/1?id=7')}`)
    expect(init?.method).toBe('GET')
    expect(init?.credentials).toBe('omit')
    expect(init?.referrerPolicy).toBe('no-referrer')
    expect(init?.body).toBeUndefined()
    expect(init?.headers).toBeUndefined()
  })

  it('previewRequestUrl drops the fragment and tracking parameters, keeps product parameters', () => {
    expect(previewRequestUrl('https://shop.example/p?sku=9&gclid=1#frag')).toBe('https://shop.example/p?sku=9')
  })
})

describe('lookupLinkPreview results', () => {
  const run = async (res: Response | (() => Response | Promise<Response>)) => {
    await setLinkPreviewEnabled(db, true)
    return lookupLinkPreview('https://shop.example/p/1', { db, fetch: mockFetch(res) })
  }

  it('returns a validated patch', async () => {
    const r = await run(jsonResponse(okBody({ title: '  Red   wool scarf ', image: { url: 'https://cdn.example/a.jpg', width: 1 }, price: '19.99', currency: 'EUR' })))
    expect(r).toEqual({
      kind: 'found',
      patch: { title: 'Red wool scarf', imageUrl: 'https://cdn.example/a.jpg', price: { amount: 1999, currency: 'EUR' } },
    })
  })

  it('returns only what is present', async () => {
    expect(await run(jsonResponse(okBody({ title: 'Just a title' })))).toEqual({ kind: 'found', patch: { title: 'Just a title' } })
  })

  it('reports nothing found for an empty or useless page', async () => {
    expect(await run(jsonResponse(okBody({ description: 'only a description', logo: { url: 'https://x.example/l.png' } })))).toEqual({ kind: 'nothing-found' })
    expect(await run(jsonResponse(okBody({ title: 'Just a moment...' })))).toEqual({ kind: 'nothing-found' })
    expect(await run(jsonResponse({ status: 'fail', code: 'EFAILED', message: 'x' }))).toEqual({ kind: 'nothing-found' })
    expect(await run(jsonResponse('{}', { status: 404 }))).toEqual({ kind: 'nothing-found' })
  })

  it('drops non-https, credentialed and oversized image URLs', async () => {
    const img = async (image: unknown) => run(jsonResponse(okBody({ title: 'T', image })))
    for (const image of ['http://cdn.example/a.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'https://u:p@cdn.example/a.jpg', { url: 'http://x.example/a' }, 'https://cdn.example/' + 'a'.repeat(2100), 42, null, ['https://cdn.example/a.jpg']]) {
      expect(await img(image)).toEqual({ kind: 'found', patch: { title: 'T' } })
    }
    expect(await img('https://cdn.example/a.jpg')).toEqual({ kind: 'found', patch: { title: 'T', imageUrl: 'https://cdn.example/a.jpg' } })
  })

  it('limits and cleans the title', async () => {
    const r = await run(jsonResponse(okBody({ title: 'x'.repeat(5000) })))
    expect(r.kind === 'found' && Array.from(r.patch.title ?? '').length).toBe(200)
    const c = await run(jsonResponse(okBody({ title: 'a\u0000b‮c\nd' })))
    expect(c).toEqual({ kind: 'found', patch: { title: 'a b c d' } })
  })

  it.each([
    ['negative', '-5'],
    ['too many decimals', '12.3456'],
    ['text', 'free'],
    ['huge', '999999999999999999'],
  ])('ignores a bad price (%s)', async (_n, price) => {
    expect(await run(jsonResponse(okBody({ title: 'T', price, currency: 'EUR' })))).toEqual({ kind: 'found', patch: { title: 'T' } })
  })

  it('ignores a price without a usable currency', async () => {
    expect(await run(jsonResponse(okBody({ title: 'T', price: '10' })))).toEqual({ kind: 'found', patch: { title: 'T' } })
    expect(await run(jsonResponse(okBody({ title: 'T', price: '10', currency: 'ZZZZ' })))).toEqual({ kind: 'found', patch: { title: 'T' } })
  })

  it('maps HTTP and body problems to typed failures', async () => {
    expect(await run(jsonResponse({}, { status: 429 }))).toEqual({ kind: 'failed', reason: 'rate-limited' })
    expect(await run(jsonResponse({ status: 'fail', code: 'ERATE' }, { status: 200 }))).toEqual({ kind: 'failed', reason: 'rate-limited' })
    expect(await run(jsonResponse({}, { status: 500 }))).toEqual({ kind: 'failed', reason: 'service-error' })
    expect(await run(jsonResponse('<html>not json</html>'))).toEqual({ kind: 'failed', reason: 'bad-response' })
    expect(await run(jsonResponse('[1,2,3]'))).toEqual({ kind: 'failed', reason: 'bad-response' })
    expect(await run(jsonResponse('null'))).toEqual({ kind: 'failed', reason: 'bad-response' })
    expect(await run(jsonResponse({ status: 'weird' }))).toEqual({ kind: 'failed', reason: 'bad-response' })
  })

  it('refuses a body that is too large, declared or not', async () => {
    const big = JSON.stringify(okBody({ title: 'x'.repeat(300_000) }))
    expect(await run(jsonResponse(big))).toEqual({ kind: 'failed', reason: 'bad-response' })
    expect(await run(jsonResponse('{}', { headers: { 'content-length': '999999999' } }))).toEqual({ kind: 'failed', reason: 'bad-response' })
  })

  it('treats hostile object shapes as nothing found, never as an error', () => {
    const polluted = JSON.parse('{"status":"success","data":{"__proto__":{"title":"x"},"title":{"toString":1},"image":{"url":{"a":1}}}}') as unknown
    expect(patchFromServiceResponse(polluted)).toBeUndefined()
    expect(patchFromServiceResponse({ status: 'success', data: null })).toBeUndefined()
    expect(patchFromServiceResponse({ status: 'success', data: [] })).toBeUndefined()
    expect(patchFromServiceResponse('success')).toBeUndefined()
    expect(({} as Record<string, unknown>).title).toBeUndefined()
  })
})

describe('lookupLinkPreview never throws', () => {
  beforeEach(async () => {
    await setLinkPreviewEnabled(db, true)
  })

  it('reports a network error', async () => {
    const f = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('Failed to fetch')))
    expect(await lookupLinkPreview('https://shop.example/p/1', { db, fetch: f })).toEqual({ kind: 'failed', reason: 'network' })
  })

  it('reports a synchronous throw from fetch', async () => {
    const f = vi.fn<typeof fetch>(() => {
      throw new Error('boom')
    })
    expect(await lookupLinkPreview('https://shop.example/p/1', { db, fetch: f })).toEqual({ kind: 'failed', reason: 'network' })
  })

  it('times out even when fetch ignores the abort signal', async () => {
    const f = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined))
    const started = Date.now()
    expect(await lookupLinkPreview('https://shop.example/p/1', { db, fetch: f, timeoutMs: 50 })).toEqual({ kind: 'failed', reason: 'timeout' })
    expect(Date.now() - started).toBeLessThan(1500)
  })

  it('times out while the body is still arriving, and aborts the request', async () => {
    let signal: AbortSignal | undefined
    const f = vi.fn<typeof fetch>((_u, init) => {
      signal = init?.signal ?? undefined
      const stream = new ReadableStream<Uint8Array>({ start() {} })
      return Promise.resolve(new Response(stream, { status: 200 }))
    })
    expect(await lookupLinkPreview('https://shop.example/p/1', { db, fetch: f, timeoutMs: 50 })).toEqual({ kind: 'failed', reason: 'timeout' })
    expect(signal?.aborted).toBe(true)
  })

  it('stops the request when the caller aborts (a changed link)', async () => {
    let signal: AbortSignal | undefined
    const f = vi.fn<typeof fetch>((_u, init) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>(() => undefined)
    })
    const controller = new AbortController()
    const pending = lookupLinkPreview('https://shop.example/p/1', { db, fetch: f, signal: controller.signal })
    await vi.waitFor(() => expect(f).toHaveBeenCalled())
    controller.abort()
    expect(await pending).toEqual({ kind: 'cancelled' })
    expect(signal?.aborted).toBe(true)
  })

  it('sends nothing when already aborted', async () => {
    const f = vi.fn<typeof fetch>()
    const controller = new AbortController()
    controller.abort()
    expect(await lookupLinkPreview('https://shop.example/p/1', { db, fetch: f, signal: controller.signal })).toEqual({ kind: 'cancelled' })
    expect(f).not.toHaveBeenCalled()
  })

  it('returns disabled rather than throwing when the database is closed', async () => {
    db.close()
    const f = mockFetch(jsonResponse(okBody({ title: 'x' })))
    const r = await lookupLinkPreview('https://shop.example/p/1', { db, fetch: f })
    expect(r.kind).toBe('disabled')
    expect(f).not.toHaveBeenCalled()
  })
})

describe('fillEmptyFields', () => {
  const patch = { title: 'New', imageUrl: 'https://cdn.example/a.jpg', price: { amount: 100, currency: 'EUR' } }
  it('fills everything into an empty form', () => {
    expect(fillEmptyFields({}, patch)).toEqual(patch)
    expect(fillEmptyFields({ title: '   ' }, patch).title).toBe('New')
  })
  it('never overwrites what the user typed', () => {
    expect(fillEmptyFields({ title: 'Mine', imageUrl: 'https://x.example/i.png', price: { amount: 5, currency: 'USD' } }, patch)).toEqual({})
  })
  it('fills only the gaps', () => {
    expect(fillEmptyFields({ title: 'Mine' }, patch)).toEqual({ imageUrl: patch.imageUrl, price: patch.price })
  })
})
