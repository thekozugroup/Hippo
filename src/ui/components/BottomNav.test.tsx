import { render, screen } from '@testing-library/react'
import { BottomNav, type BottomNavItem } from './BottomNav.tsx'

const ITEMS: BottomNavItem[] = [
  { id: 'home', label: 'Home', icon: <svg />, href: '#/' },
  { id: 'wishlist', label: 'Wishlist', icon: <svg />, href: '#/wishlist' },
  { id: 'lists', label: 'Lists', icon: <svg />, href: '#/lists' },
  { id: 'settings', label: 'Settings', icon: <svg />, href: '#/settings' },
]

const nav = (activeId: string, extra: { remember?: string; key?: string } = {}) => <BottomNav items={ITEMS} activeId={activeId} label="Main" {...extra} />

describe('BottomNav', () => {
  it('shows no dot after the active label, and the label names every destination', () => {
    const { container } = render(nav('home'))
    expect(container.querySelector('.bottom-nav__dot')).toBeNull()
    expect(container.querySelector('[aria-hidden="true"]:not(.bottom-nav__icon)')).toBeNull()
    expect(container.textContent).not.toMatch(/[•·●]/)
    for (const item of ITEMS) expect(screen.getByRole('link', { name: item.label })).toBeInTheDocument()
  })

  it('marks the active destination with aria-current and exactly one active item', () => {
    const { container } = render(nav('lists'))
    expect(screen.getByRole('link', { name: 'Lists' })).toHaveAttribute('aria-current', 'page')
    expect(container.querySelectorAll('[aria-current]')).toHaveLength(1)
    expect(container.querySelectorAll('.is-active')).toHaveLength(1)
    expect(container.querySelector('.is-active')).toBe(screen.getByRole('link', { name: 'Lists' }))
  })

  it('ends with one active item after rapid changes', () => {
    const { container, rerender } = render(nav('home', { remember: 'rapid' }))
    for (const id of ['wishlist', 'lists', 'settings', 'home', 'lists']) rerender(nav(id, { remember: 'rapid' }))
    expect(container.querySelectorAll('.is-active')).toHaveLength(1)
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Lists' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Lists' })).toHaveClass('is-active')
  })

  it('moves aria-current with the very render that changes the destination', () => {
    const { rerender } = render(nav('home'))
    rerender(nav('settings'))
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
  })
})

describe('BottomNav switch motion', () => {
  type Call = { el: Element; frames: Keyframe[]; opts: KeyframeAnimationOptions }
  let calls: Call[]
  const original = Element.prototype.animate
  const grow = new Map<string, string>()

  beforeEach(() => {
    calls = []
    grow.clear()
    Element.prototype.animate = function (this: Element, frames: Keyframe[] | PropertyIndexedKeyframes | null, opts?: number | KeyframeAnimationOptions) {
      calls.push({ el: this, frames: frames as Keyframe[], opts: opts as KeyframeAnimationOptions })
      return { playState: 'running', finished: new Promise(() => undefined), cancel: () => undefined } as unknown as Animation
    }
    const real = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
      const g = grow.get((el as HTMLElement).dataset?.navId ?? '')
      const style = real(el, pseudo)
      return g === undefined ? style : ({ ...style, flexGrow: g } as unknown as CSSStyleDeclaration)
    })
  })

  afterEach(() => {
    Element.prototype.animate = original
    vi.restoreAllMocks()
  })

  const growCalls = () => calls.filter((c) => c.frames.some((f) => 'flexGrow' in f))
  const id = (c: Call) => (c.el as HTMLElement).dataset.navId

  /** A new screen's nav replacing the old one in the same commit (as the router does). */
  const switchTo = (view: ReturnType<typeof render>, activeId: string, key: string, remember = 'm') => view.rerender(nav(activeId, { key, remember }))

  it('does not animate on first render, nor when the destination is unchanged', () => {
    const view = render(nav('home', { key: 'a', remember: 'first' }))
    switchTo(view, 'home', 'b', 'first')
    expect(calls).toHaveLength(0)
  })

  it('shrinks the previous destination and grows the new one together, on one clock', () => {
    const view = render(nav('home', { key: 'a', remember: 'pair' }))
    switchTo(view, 'lists', 'b', 'pair')
    const g = growCalls()
    expect(g.map(id).sort()).toEqual(['home', 'lists'])
    expect(g.find((c) => id(c) === 'home')?.frames).toEqual([{ flexGrow: 1 }, { flexGrow: 0 }])
    expect(g.find((c) => id(c) === 'lists')?.frames).toEqual([{ flexGrow: 0 }, { flexGrow: 1 }])
    expect(new Set(calls.map((c) => `${c.opts.duration}|${c.opts.easing}`)).size).toBe(1)
    // The label fades with the width; the other destinations are left alone.
    expect(calls.filter((c) => c.frames.some((f) => 'opacity' in f))).toHaveLength(4)
    expect(calls.some((c) => ['wishlist', 'settings'].includes(id(c) ?? ''))).toBe(false)
    expect(document.querySelector('.bottom-nav')).toHaveAttribute('data-switching')
    expect(document.querySelectorAll('.is-active')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Lists' })).toHaveAttribute('aria-current', 'page')
  })

  it('carries on from where an interrupted switch was (no jump) when switched again', () => {
    const view = render(nav('home', { key: 'a', remember: 'rapid-motion' }))
    switchTo(view, 'wishlist', 'b', 'rapid-motion')
    calls.length = 0
    // Mid-way: Home is nearly a circle, Wishlist nearly a pill.
    grow.set('home', '0.25')
    grow.set('wishlist', '0.75')
    grow.set('lists', '0')
    grow.set('settings', '0')
    switchTo(view, 'lists', 'c', 'rapid-motion')
    const g = growCalls()
    expect(g.find((c) => id(c) === 'home')?.frames).toEqual([{ flexGrow: 0.25 }, { flexGrow: 0 }])
    expect(g.find((c) => id(c) === 'wishlist')?.frames).toEqual([{ flexGrow: 0.75 }, { flexGrow: 0 }])
    expect(g.find((c) => id(c) === 'lists')?.frames).toEqual([{ flexGrow: 0 }, { flexGrow: 1 }])
    expect(document.querySelectorAll('.is-active')).toHaveLength(1)
  })

  it('does not animate under reduced motion', () => {
    window.matchMedia = ((q: string) => ({ matches: /reduce/.test(q), media: q }) as unknown as MediaQueryList) as typeof window.matchMedia
    const view = render(nav('home', { key: 'a', remember: 'reduced' }))
    switchTo(view, 'lists', 'b', 'reduced')
    expect(calls).toHaveLength(0)
    expect(screen.getByRole('link', { name: 'Lists' })).toHaveAttribute('aria-current', 'page')
    delete (window as { matchMedia?: unknown }).matchMedia
  })

  it('does not animate for a nav that mounts long after the last one left', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const spy = vi.spyOn(performance, 'now')
    spy.mockReturnValue(1000)
    const view = render(nav('home', { key: 'a', remember: 'stale' }))
    view.unmount()
    spy.mockReturnValue(5000)
    render(nav('lists', { key: 'b', remember: 'stale' }))
    expect(calls).toHaveLength(0)
    vi.useRealTimers()
  })
})
