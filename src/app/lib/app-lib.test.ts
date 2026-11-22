import { handleStartupCapture, peekCaptureDraft, clearCaptureDraft } from '../core/capture.ts'
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
