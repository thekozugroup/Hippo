import { act, fireEvent, render, screen } from '@testing-library/react'
import { LogoIntro } from './LogoIntro.tsx'
import { INTRO_DEADLINE_MS, INTRO_HOLD_ATTR, INTRO_START_WAIT_MS, introCanStart } from './introGate.ts'

type Animate = typeof Element.prototype.animate

function stubMotion(reduce: boolean) {
  // Present so motion counts as supported; the intro never depends on it.
  const animate = vi.fn(() => ({ cancel: vi.fn(), onfinish: null, oncancel: null }) as unknown as Animation)
  Element.prototype.animate = animate as unknown as Animate
  Element.prototype.getBoundingClientRect = () => ({ x: 24, y: 22, left: 24, top: 22, right: 124, bottom: 50, width: 100, height: 28, toJSON: () => ({}) })
  window.matchMedia = ((q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia
  return { animate }
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

const logoOf = (c: HTMLElement) => c.querySelector<HTMLElement>('.logo')!

describe('LogoIntro', () => {
  const original = Element.prototype.animate
  const originalMatch = window.matchMedia
  const originalRect = Element.prototype.getBoundingClientRect
  beforeEach(() => {
    vi.useFakeTimers()
    setVisibility('visible')
  })
  afterEach(() => {
    vi.useRealTimers()
    Element.prototype.getBoundingClientRect = originalRect
    Element.prototype.animate = original
    window.matchMedia = originalMatch
    document.documentElement.removeAttribute(INTRO_HOLD_ATTR)
    setVisibility('visible')
  })

  it('stays still and reports itself played when motion is reduced', () => {
    stubMotion(true)
    const onPlay = vi.fn()
    const { container } = render(<LogoIntro play onPlay={onPlay} />)
    expect(container.querySelector('.logo--intro, .logo--blink')).toBeNull()
    expect(logoOf(container).style.transform).toBe('')
    expect(onPlay).toHaveBeenCalledTimes(1)
  })

  it('does nothing when it is not asked to play (for example on a return to step 1)', () => {
    stubMotion(false)
    const onPlay = vi.fn()
    const { container } = render(<LogoIntro onPlay={onPlay} />)
    expect(logoOf(container).style.transform).toBe('')
    expect(container.querySelector('.logo--intro')).toBeNull()
    expect(onPlay).not.toHaveBeenCalled()
  })

  it('is large with the blink on from the first frame, travels on its own clock, and rests with no inline transform', () => {
    stubMotion(false)
    const onPlay = vi.fn()
    const { container } = render(<LogoIntro play onPlay={onPlay} />)
    const logo = logoOf(container)
    expect(onPlay).toHaveBeenCalledTimes(1)
    expect(logo).toHaveClass('logo--intro', 'logo--blink')
    expect(logo.style.transform).toMatch(/scale\(/)
    expect(screen.getAllByText('Hippo')).toHaveLength(1)
    act(() => void vi.advanceTimersByTime(1450))
    expect(logo.dataset.intro).toBe('travel')
    expect(logo).not.toHaveClass('logo--blink')
    // No animation event ever fires here: the clock alone lands it.
    act(() => void vi.advanceTimersByTime(700))
    expect(logo.style.transform).toBe('')
    expect(logo).not.toHaveClass('logo--intro')
  })

  it('lands at once on a key press, a press or a scroll', () => {
    stubMotion(false)
    for (const fire of [() => fireEvent.keyDown(window, { key: 'a' }), () => fireEvent.pointerDown(window), () => fireEvent.scroll(window)]) {
      const { container, unmount } = render(<LogoIntro play />)
      expect(logoOf(container).style.transform).not.toBe('')
      act(() => void fire())
      expect(logoOf(container).style.transform).toBe('')
      expect(container.querySelector('.logo--intro')).toBeNull()
      unmount()
    }
  })

  it('the deadline lands it even when the travel timer is stalled', () => {
    stubMotion(false)
    const { container } = render(<LogoIntro play />)
    const logo = logoOf(container)
    // Whatever the phases do, by the deadline the logo is at rest.
    act(() => void vi.advanceTimersByTime(INTRO_DEADLINE_MS))
    expect(logo.style.transform).toBe('')
    expect(logo.dataset.intro).toBeUndefined()
  })

  it('waits while the page is hidden and starts when it becomes visible', () => {
    stubMotion(false)
    setVisibility('hidden')
    const onPlay = vi.fn()
    const { container } = render(<LogoIntro play onPlay={onPlay} />)
    const logo = logoOf(container)
    expect(logo.style.transform).toBe('')
    expect(onPlay).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(1000))
    act(() => setVisibility('visible'))
    expect(onPlay).toHaveBeenCalledTimes(1)
    expect(logo.style.transform).toMatch(/scale\(/)
    act(() => void vi.advanceTimersByTime(INTRO_DEADLINE_MS))
    expect(logo.style.transform).toBe('')
  })

  it('waits for the app splash to go, and does not play at all if it never goes', () => {
    stubMotion(false)
    document.documentElement.setAttribute(INTRO_HOLD_ATTR, '')
    expect(introCanStart(document)).toBe(false)
    const onPlay = vi.fn()
    const { container } = render(<LogoIntro play onPlay={onPlay} />)
    act(() => void vi.advanceTimersByTime(INTRO_START_WAIT_MS + 10))
    expect(onPlay).not.toHaveBeenCalled()
    expect(logoOf(container).style.transform).toBe('')
    document.documentElement.removeAttribute(INTRO_HOLD_ATTR)
  })

  it('starts as soon as the splash goes', async () => {
    stubMotion(false)
    document.documentElement.setAttribute(INTRO_HOLD_ATTR, '')
    const onPlay = vi.fn()
    const { container } = render(<LogoIntro play onPlay={onPlay} />)
    await act(async () => {
      document.documentElement.removeAttribute(INTRO_HOLD_ATTR)
      await Promise.resolve()
    })
    expect(onPlay).toHaveBeenCalledTimes(1)
    expect(logoOf(container).style.transform).toMatch(/scale\(/)
  })
})
