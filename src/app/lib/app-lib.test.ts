import { captureEpoch, captureShared, handleStartupCapture, peekCaptureDraft, clearCaptureDraft, subscribeCapture } from '../core/capture.ts'
import { bookmarkletCode, shortcutScript } from './capture-tools.ts'
import { formatEventDate, moneyInputValue, parseMoneyInput, safeUrl, summariseSync } from './format.ts'

function fakeLocation(href: string): Location {
  const u = new URL(href)
  return { href: u.href, search: u.search } as Location
}

describe('startup capture', () => {
  afterEach(() => clearCaptureDraft())

  it('turns deep-link parameters into a draft, opens the form and strips the query', () => {
    const replaceState = vi.fn()
    const draft = handleStartupCapture(fakeLocation('https://x.example/hippo/?title=Lamp&url=https%3A%2F%2Fshop.example%2Flamp&price=12.50&currency=EUR'), {
      replaceState,
    } as unknown as History)
    expect(draft).toEqual({ title: 'Lamp', url: 'https://shop.example/lamp', price: { amount: 1250, currency: 'EUR' } })
    expect(peekCaptureDraft()).toEqual(draft)
    expect(replaceState).toHaveBeenCalledWith(null, '', 'https://x.example/hippo/#/item/new')
  })

  it('drops non-http URLs and only strips the query when there is nothing to capture', () => {
    const replaceState = vi.fn()
    const draft = handleStartupCapture(fakeLocation('https://x.example/?url=javascript%3Aalert(1)&image=data%3Atext%2Fhtml%2Cx&title=Hi'), {
      replaceState,
    } as unknown as History)
    expect(draft).toEqual({ title: 'Hi' })
    handleStartupCapture(fakeLocation('https://x.example/?relays=ws%3A%2F%2F127.0.0.1%3A7447#/wishlist'), { replaceState } as unknown as History)
    expect(replaceState).toHaveBeenLastCalledWith(null, '', 'https://x.example/#/wishlist')
  })
})

describe('shared from another app (Android app share target)', () => {
  afterEach(() => clearCaptureDraft())

  it('goes through the same capture path as the deep link: link found in the text, tracking removed, title kept', () => {
    const seen = vi.fn()
    const stop = subscribeCapture(seen)
    const before = captureEpoch()
    const draft = captureShared({ title: 'Red wool scarf', text: 'Have a look: https://shop.example/p/scarf?utm_source=android&fbclid=abc&colour=red.' })
    expect(draft).toEqual({ title: 'Red wool scarf', url: 'https://shop.example/p/scarf?colour=red' })
    expect(peekCaptureDraft()).toEqual(draft)
    expect(captureEpoch()).toBe(before + 1)
    expect(seen).toHaveBeenCalledTimes(1)
    stop()
  })

  it('guesses a title from the link when only a link is shared', () => {
    expect(captureShared({ text: 'https://shop.example/products/blue-ceramic-mug-1234' })).toEqual({ title: 'Blue ceramic mug', url: 'https://shop.example/products/blue-ceramic-mug-1234' })
  })

  it('refuses unsafe links and non-strings, and caps lengths like the deep link', () => {
    expect(captureShared({ text: 'javascript:alert(1)' })).toEqual({ title: 'javascript:alert(1)' })
    expect(captureShared({ title: 7, text: null })).toBeNull()
    expect(captureShared({})).toBeNull()
    const long = captureShared({ title: 'x'.repeat(10_000) })
    expect(long && Array.from(long.title).length).toBeLessThanOrEqual(200)
  })
})

describe('format helpers', () => {
  it('round-trips money input', () => {
    expect(moneyInputValue({ amount: 5, currency: 'USD' })).toBe('0.05')
    expect(moneyInputValue({ amount: 1200, currency: 'JPY' })).toBe('1200')
    expect(parseMoneyInput('24.90', 'USD')).toEqual({ amount: 2490, currency: 'USD' })
    expect(parseMoneyInput('', 'USD')).toBeNull()
    expect(parseMoneyInput('abc', 'USD')).toBeUndefined()
    expect(parseMoneyInput('0', 'USD')).toBeUndefined()
  })

  it('formats an event date without time-zone drift', () => {
    expect(formatEventDate('2027-03-14', 'en-US')).toBe('Sun, Mar 14, 2027')
  })

  it('only lets http(s) URLs through', () => {
    expect(safeUrl('https://a.example/x')).toBe('https://a.example/x')
    expect(safeUrl('javascript:alert(1)')).toBeUndefined()
    expect(safeUrl(undefined)).toBeUndefined()
  })

  it('summarises per-server results across events', () => {
    const ok = (relay: string) => ({ relay, ok: true })
    const s = summariseSync([
      {
        events: [
          { result: { ok: true, relays: [ok('wss://a'), { relay: 'wss://b', ok: false, message: 'timeout' }] } },
          { result: { ok: true, relays: [ok('wss://a'), ok('wss://b')] } },
        ],
      },
    ])
    expect(s).toMatchObject({ accepted: 1, total: 2, empty: false })
    expect(summariseSync([{ events: [] }]).empty).toBe(true)
  })
})

describe('capture tools', () => {
  it('builds a bookmarklet and shortcut script for this install', () => {
    const code = bookmarkletCode('https://me.github.io/hippo/')
    expect(code.startsWith('javascript:')).toBe(true)
    expect(code).toContain('"https://me.github.io/hippo/"')
    expect(code).toContain("'noopener'")
    expect(shortcutScript('https://me.github.io/hippo/')).toMatch(/completion\(u\);$/)
  })
})

describe('capture scripts send a clean page address', () => {
  function runShortcut(): URL {
    let out = ''
    const script = shortcutScript('https://me.github.io/hippo/')
    new Function('completion', script)((u: string) => {
      out = u
    })
    return new URL(out)
  }

  afterEach(() => {
    document.head.innerHTML = ''
    window.history.replaceState(null, '', '/')
  })

  it('prefers the canonical link and drops tracking parameters but keeps product ones', () => {
    document.head.innerHTML = '<link rel="canonical" href="https://shop.example/p/42?color=red&utm_source=news&fbclid=x#reviews">'
    expect(runShortcut().searchParams.get('url')).toBe('https://shop.example/p/42?color=red')
  })

  it('without a canonical link, uses the page address without its fragment', () => {
    window.history.replaceState(null, '', '/item?id=7&gclid=abc#secret-part')
    expect(runShortcut().searchParams.get('url')).toBe(`${window.location.origin}/item?id=7`)
  })
})
