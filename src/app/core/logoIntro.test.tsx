import { render, screen } from '@testing-library/react'
import { createCore, MemoryTransport } from '../../core/index.ts'
import { App } from '../App.tsx'
import { markLogoIntroPlayed, shouldPlayLogoIntro } from './logoIntro.ts'

describe('logo intro on the first setup step', () => {
  const original = Element.prototype.animate
  const originalRect = Element.prototype.getBoundingClientRect
  const originalMatch = window.matchMedia
  afterEach(() => {
    window.matchMedia = originalMatch
    Element.prototype.getBoundingClientRect = originalRect
    Element.prototype.animate = original
    localStorage.removeItem('hippo:logoIntro')
  })

  it('is marked as played after the first run, and does not play again', async () => {
    const animate = vi.fn(() => ({ cancel: () => undefined, onfinish: null, oncancel: null }) as unknown as Animation)
    Element.prototype.animate = animate as unknown as typeof Element.prototype.animate
    Element.prototype.getBoundingClientRect = () => ({ x: 24, y: 22, left: 24, top: 22, right: 124, bottom: 50, width: 100, height: 28, toJSON: () => ({}) })
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia
    expect(shouldPlayLogoIntro()).toBe(true)
    window.location.hash = '#/welcome/start'
    const first = render(<App core={createCore({ dbName: `intro-${Math.random()}`, transport: new MemoryTransport() })} />)
    await screen.findByRole('heading', { level: 1, name: /Make a wishlist/ })
    expect(animate).toHaveBeenCalledTimes(1)
    expect(shouldPlayLogoIntro()).toBe(false)
    first.unmount()

    window.location.hash = '#/welcome/start'
    render(<App core={createCore({ dbName: `intro-${Math.random()}`, transport: new MemoryTransport() })} />)
    await screen.findByRole('heading', { level: 1, name: /Make a wishlist/ })
    expect(animate).toHaveBeenCalledTimes(1)
  })

  it('stays skipped when storage is unavailable', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(shouldPlayLogoIntro()).toBe(false)
    get.mockRestore()
    markLogoIntroPlayed()
    expect(shouldPlayLogoIntro()).toBe(false)
  })
})
