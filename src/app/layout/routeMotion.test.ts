import { describe, expect, it } from 'vitest'
import { directionFor, routeInfo } from './routeMotion.ts'

describe('route transition direction', () => {
  it('reads going deeper as forward and coming back as back', () => {
    expect(directionFor('/wishlist', '/item/abc', 'push')).toBe('forward')
    expect(directionFor('/', '/item/new', 'push')).toBe('forward')
    expect(directionFor('/lists', '/list/xyz', 'push')).toBe('forward')
    expect(directionFor('/item/abc', '/wishlist', 'push')).toBe('back')
    expect(directionFor('/list/xyz', '/lists', 'pop-back')).toBe('back')
  })

  it('switches between bottom-navigation destinations laterally, whichever way history goes', () => {
    expect(directionFor('/', '/wishlist', 'push')).toBe('lateral')
    expect(directionFor('/settings', '/lists', 'pop-back')).toBe('lateral')
    expect(directionFor('/lists', '/', 'pop-forward')).toBe('lateral')
  })

  it('follows history for Back and Forward, even when that goes deeper', () => {
    // Detail -> tab by the nav, then browser Back returns to the detail: still "back".
    expect(directionFor('/wishlist', '/item/abc', 'pop-back')).toBe('back')
    expect(directionFor('/wishlist', '/item/abc', 'pop-forward')).toBe('forward')
    expect(directionFor('/item/abc', '/wishlist', 'pop-forward')).toBe('forward')
  })

  it('moves between screens at the same depth forward on a push', () => {
    expect(directionFor('/item/a', '/list/b', 'push')).toBe('forward')
    expect(directionFor('/g/topic', '/item/new', 'push')).toBe('forward')
  })

  it('orders setup steps by their number in both directions', () => {
    expect(directionFor('/welcome/start', '/welcome/name', 'push')).toBe('forward')
    expect(directionFor('/welcome/wish', '/welcome/occasion', 'pop-back')).toBe('back')
    expect(directionFor('/welcome/name', '/welcome/occasion', 'pop-forward')).toBe('forward')
    // A Back button that replaces the entry still reads as back... but replace never animates.
    expect(directionFor('/welcome/occasion', '/welcome/name', 'replace')).toBe('none')
  })

  it('does not animate redirects, the first render or no change', () => {
    expect(directionFor('/', '/welcome/start', 'replace')).toBe('none')
    expect(directionFor('/l/abc', '/g/topic', 'replace')).toBe('none')
    expect(directionFor('/', '/wishlist', 'initial')).toBe('none')
    expect(directionFor('/wishlist', '/wishlist', 'push')).toBe('none')
  })

  it('ignores a ?query inside the fragment and unknown steps', () => {
    expect(routeInfo('/settings?x=1')).toEqual({ level: 0, tab: 3 })
    expect(routeInfo('/welcome/nope')).toEqual({ level: 1 })
    expect(routeInfo('/welcome/capture')).toEqual({ level: 1, step: 4 })
  })
})
