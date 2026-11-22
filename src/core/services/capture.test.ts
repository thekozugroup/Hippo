// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { captureFromSearchParams, currencyDigits, draftFromCapture, findFirstHttpUrl, guessTitleFromUrl, parsePrice } from './capture.ts'

describe('findFirstHttpUrl', () => {
  it.each([
    ['Look at this https://shop.example/p/1, nice!', 'https://shop.example/p/1'],
    ['(see https://en.wikipedia.org/wiki/Hippo_(animal))', 'https://en.wikipedia.org/wiki/Hippo_(animal)'],
    ['ftp://x.example and http://a.example/b.', 'http://a.example/b'],
    ['no url here', undefined],
    ['javascript:alert(1)', undefined],
    ['', undefined],
  ])('%s', (text, expected) => {
    expect(findFirstHttpUrl(text)).toBe(expected)
  })
})

describe('guessTitleFromUrl', () => {
  it.each([
    ['https://www.shop.example/p/red-wool-scarf-12345.html', 'Red wool scarf'],
    ['https://www.amazon.example/Hippo-Plush-Toy/dp/B000123456', 'Hippo plush toy'],
    ['https://shop.example/products/blue_bike?ref=x', 'Blue bike'],
    ['https://www.example.com/', 'example.com'],
    ['https://example.com/12345', 'example.com'],
    ['https://example.com/caf%C3%A9-table', 'Café table'],
    ['not a url', ''],
  ])('%s', (url, expected) => {
    expect(guessTitleFromUrl(url)).toBe(expected)
  })
})

describe('parsePrice', () => {
  it.each([
    ['12', 'EUR', 1200],
    ['12.5', 'EUR', 1250],
    ['12,50 €', undefined, 1250],
    ['€1.234,56', undefined, 123456],
    ['$1,234.56', undefined, 123456],
    ['1 234,50 EUR', undefined, 123450],
    ['1.234', 'EUR', 123400],
    ['1,234,567', 'USD', 123456700],
    ["CHF 1'234.50", undefined, 123450],
    ['¥1,500', undefined, 1500],
    ['0.99', 'GBP', 99],
    ['19.99 usd', undefined, 1999],
  ])('%s %s -> %s', (input, currency, amount) => {
    expect(parsePrice(input, currency)?.amount).toBe(amount)
  })

  it.each([
    ['-5', 'EUR'],
    ['abc', 'EUR'],
    ['12', undefined],
    ['12.345.6', 'EUR'],
    ['1,23,45', 'EUR'],
    ['¥15.5', undefined],
    ['12.9999', 'EUR'],
    ['99999999999999999', 'EUR'],
    ['', 'EUR'],
    ['1e5', 'EUR'],
  ])('rejects %s %s', (input, currency) => {
    expect(parsePrice(input, currency)).toBeUndefined()
  })

  it('reports currency digits', () => {
    expect(currencyDigits('JPY')).toBe(0)
    expect(currencyDigits('EUR')).toBe(2)
    expect(currencyDigits('KWD')).toBe(3)
    expect(currencyDigits('eur')).toBeUndefined()
  })
})

describe('draftFromCapture', () => {
  it('builds a draft from an Android-style share', () => {
    expect(draftFromCapture({ title: 'Hippo plush', text: 'Check this out https://shop.example/p/hippo-plush' })).toEqual({
      title: 'Hippo plush',
      url: 'https://shop.example/p/hippo-plush',
    })
  })

  it('guesses a title from the URL and parses price and image', () => {
    expect(
      draftFromCapture({ url: 'https://shop.example/p/red-wool-scarf', image: 'https://cdn.example/a.jpg', price: '25,00', currency: 'EUR' }),
    ).toEqual({ title: 'Red wool scarf', url: 'https://shop.example/p/red-wool-scarf', imageUrl: 'https://cdn.example/a.jpg', price: { amount: 2500, currency: 'EUR' } })
  })

  it('falls back to the text and drops unsafe image URLs', () => {
    expect(draftFromCapture({ text: 'A hippopotamus', image: 'javascript:alert(1)' })).toEqual({ title: 'A hippopotamus' })
  })

  it('reads deep link parameters', () => {
    expect(captureFromSearchParams('?title=Hippo&url=https%3A%2F%2Fa.example&price=10&currency=EUR')).toEqual({
      title: 'Hippo',
      url: 'https://a.example',
      price: '10',
      currency: 'EUR',
    })
    expect(captureFromSearchParams('?foo=1')).toBeNull()
  })
})
