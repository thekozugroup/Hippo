import { act, fireEvent, render, screen } from '@testing-library/react'
import { LogoIntro } from './LogoIntro.tsx'

type Animate = typeof Element.prototype.animate

function stubMotion(reduce: boolean) {
  const cancel = vi.fn()
  const animate = vi.fn(() => ({ cancel, onfinish: null, oncancel: null }) as unknown as Animation)
  Element.prototype.animate = animate as unknown as Animate
  Element.prototype.getBoundingClientRect = () => ({ x: 24, y: 22, left: 24, top: 22, right: 124, bottom: 50, width: 100, height: 28, toJSON: () => ({}) })
  window.matchMedia = ((q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia
  return { animate, cancel }
}

describe('LogoIntro', () => {
  const original = Element.prototype.animate
  const originalMatch = window.matchMedia
  const originalRect = Element.prototype.getBoundingClientRect
  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalRect
    Element.prototype.animate = original
    window.matchMedia = originalMatch
  })

  it('stays still and reports itself played when motion is reduced', () => {
    const { animate } = stubMotion(true)
    const onPlay = vi.fn()
    const { container } = render(<LogoIntro play onPlay={onPlay} />)
    expect(animate).not.toHaveBeenCalled()
    expect(container.querySelector('.logo--intro, .logo--blink')).toBeNull()
    expect(onPlay).toHaveBeenCalledTimes(1)
  })

  it('does nothing when it is not asked to play', () => {
    const { animate } = stubMotion(false)
    const onPlay = vi.fn()
    render(<LogoIntro onPlay={onPlay} />)
    expect(animate).not.toHaveBeenCalled()
    expect(onPlay).not.toHaveBeenCalled()
  })

  it('plays once with the blink on, keeps one name for assistive technology, and snaps to rest on a key press', () => {
    const { animate, cancel } = stubMotion(false)
    const onPlay = vi.fn()
    const { container } = render(<LogoIntro play onPlay={onPlay} />)
    expect(animate).toHaveBeenCalledTimes(1)
    expect(onPlay).toHaveBeenCalledTimes(1)
    const logo = container.querySelector('.logo')!
    expect(logo).toHaveClass('logo--intro', 'logo--blink')
    expect(screen.getAllByText('Hippo')).toHaveLength(1)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    act(() => void fireEvent.keyDown(window, { key: 'a' }))
    expect(cancel).toHaveBeenCalled()
  })
})
