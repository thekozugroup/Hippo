import { describe, expect, it } from 'vitest'
import { captureMethodFor, parseWish, wishError } from './flow.ts'

describe('the wish answer', () => {
  it('takes plain words as the wish', () => {
    expect(parseWish('  Cosy   socks ')).toEqual({ title: 'Cosy socks' })
    expect(parseWish('   ')).toBeNull()
  })
  it('saves a pasted link without tracking parameters and names the wish from the words or the link', () => {
    expect(parseWish('Headphones https://shop.example/p/123?utm_source=x&id=4')).toEqual({ title: 'Headphones', url: 'https://shop.example/p/123?id=4' })
    const fromLink = parseWish('https://shop.example/blue-wool-scarf')
    expect(fromLink?.url).toBe('https://shop.example/blue-wool-scarf')
    expect(fromLink?.title.toLowerCase()).toContain('scarf')
  })
  it('explains what to do when empty or too long', () => {
    expect(wishError('')).toMatch(/skip this step/)
    expect(wishError('x'.repeat(201))).toMatch(/200/)
    expect(wishError('A good book')).toBeUndefined()
  })
})

describe('the capture method for this device', () => {
  const base = { maxTouchPoints: 0 }
  it('offers the Shortcut on iPhone and iPad (including iPad in desktop mode)', () => {
    expect(captureMethodFor({ ...base, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })).toBe('shortcut')
    expect(captureMethodFor({ ...base, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 })).toBe('shortcut')
  })
  it('offers the share sheet on Android: setup asks to install just before', () => {
    expect(captureMethodFor({ ...base, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/140' })).toBe('share')
  })
  it('offers the bookmarklet on a computer: installing has its own step', () => {
    expect(captureMethodFor({ ...base, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140' })).toBe('bookmarklet')
    expect(captureMethodFor({ ...base, userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0' })).toBe('bookmarklet')
  })
})
