import { act, fireEvent, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { SlideButton } from './SlideButton.tsx'
import { completesAt, dragIntent, isRepeat, knobOffset, labelOpacity, slideProgress, SLIDE_THRESHOLD } from './slide.ts'

describe('slide logic', () => {
  it('tells a slide from a scroll only once the press has moved past the slop', () => {
    expect(dragIntent(3, 2)).toBe('undecided')
    expect(dragIntent(12, 3)).toBe('slide')
    expect(dragIntent(-12, 3)).toBe('slide')
    expect(dragIntent(4, 14)).toBe('scroll')
    expect(dragIntent(10, 10)).toBe('scroll')
  })

  it('keeps the knob on the track and completes from about 60 percent', () => {
    expect(knobOffset(-20, 200)).toBe(0)
    expect(knobOffset(80, 200)).toBe(80)
    expect(knobOffset(500, 200)).toBe(200)
    expect(knobOffset(50, 0)).toBe(0)
    expect(knobOffset(Number.NaN, 200)).toBe(0)
    expect(slideProgress(120, 200)).toBe(0.6)
    expect(slideProgress(10, 0)).toBe(0)
    expect(SLIDE_THRESHOLD).toBe(0.6)
    expect(completesAt(0.59)).toBe(false)
    expect(completesAt(0.6)).toBe(true)
    expect(completesAt(1)).toBe(true)
  })

  it('fades the label as the knob covers it', () => {
    expect(labelOpacity(0)).toBe(1)
    expect(labelOpacity(0.25)).toBeCloseTo(0.55)
    expect(labelOpacity(0.6)).toBe(0)
  })

  it('counts activations close together once', () => {
    expect(isRepeat(100, undefined, 700)).toBe(false)
    expect(isRepeat(500, 100, 700)).toBe(true)
    expect(isRepeat(900, 100, 700)).toBe(false)
  })
})

/** jsdom has no layout: a 300px track with a 48px knob and 4px padding (max travel 244px). */
function stubLayout(rtl = false) {
  const restore: Array<() => void> = []
  const define = (proto: object, key: string, get: (this: HTMLElement) => number) => {
    const before = Object.getOwnPropertyDescriptor(proto, key)
    Object.defineProperty(proto, key, { configurable: true, get })
    restore.push(() => (before ? Object.defineProperty(proto, key, before) : delete (proto as Record<string, unknown>)[key]))
  }
  define(HTMLElement.prototype, 'clientWidth', function () {
    return this.classList.contains('slide-btn') ? 300 : 0
  })
  define(HTMLElement.prototype, 'offsetWidth', function () {
    return this.classList.contains('slide-btn__knob') ? 48 : 0
  })
  const rect = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function () {
    const knob = this.classList.contains('slide-btn__knob')
    const left = knob ? (rtl ? 248 : 4) : 0
    const width = knob ? 48 : 300
    return { x: left, y: 0, left, top: 0, right: left + width, bottom: 56, width, height: 56, toJSON: () => ({}) }
  }
  restore.push(() => (Element.prototype.getBoundingClientRect = rect))
  const style = window.getComputedStyle
  window.getComputedStyle = ((el: Element) => {
    const s = style(el)
    return new Proxy(s, {
      get: (t, k) => {
        if (k === 'paddingInlineStart') return '4px'
        if (k === 'direction') return rtl ? 'rtl' : 'ltr'
        const v: unknown = Reflect.get(t, k, t)
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v
      },
    })
  }) as typeof window.getComputedStyle
  restore.push(() => (window.getComputedStyle = style))
  return () => restore.forEach((r) => r())
}

function slide(btn: HTMLElement, from: number, to: number, opts: { dy?: number; cancel?: boolean; noClick?: boolean } = {}) {
  fireEvent.pointerDown(btn, { pointerId: 1, pointerType: 'touch', clientX: from, clientY: 28, button: 0 })
  const steps = 6
  for (let i = 1; i <= steps; i++) {
    fireEvent.pointerMove(btn, { pointerId: 1, pointerType: 'touch', clientX: from + ((to - from) * i) / steps, clientY: 28 + ((opts.dy ?? 0) * i) / steps })
  }
  if (opts.cancel) fireEvent.pointerCancel(btn, { pointerId: 1, pointerType: 'touch' })
  else fireEvent.pointerUp(btn, { pointerId: 1, pointerType: 'touch', clientX: to, clientY: 28 })
  // The click a browser may still send for the same press (a scroll sends none).
  if (!opts.noClick) fireEvent.click(btn, { detail: 1 })
}

describe('SlideButton', () => {
  let restore: () => void
  beforeEach(() => {
    restore = stubLayout()
    HTMLElement.prototype.setPointerCapture = () => undefined
  })
  afterEach(() => restore())

  it('is a native button with one name; a tap, Enter and Space each activate it', async () => {
    const onActivate = vi.fn()
    render(<SlideButton label="Get started" onActivate={onActivate} />)
    const btn = screen.getByRole('button', { name: 'Get started' })
    expect(btn.tagName).toBe('BUTTON')
    await userEvent.click(btn)
    expect(onActivate).toHaveBeenCalledTimes(1)
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 10_000)
    btn.focus()
    await userEvent.keyboard('{Enter}')
    expect(onActivate).toHaveBeenCalledTimes(2)
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 20_000)
    await userEvent.keyboard(' ')
    expect(onActivate).toHaveBeenCalledTimes(3)
    vi.restoreAllMocks()
  })

  it('a slide past the threshold activates once, sends slidecomplete, and a tap during the settle does nothing', () => {
    const onActivate = vi.fn()
    const onComplete = vi.fn()
    document.addEventListener('slidecomplete', onComplete)
    render(<SlideButton label="Continue" onActivate={onActivate} />)
    const btn = screen.getByRole('button', { name: 'Continue' })
    slide(btn, 28, 28 + 160)
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(btn.querySelector<HTMLElement>('.slide-btn__knob')!.style.transform).toBe('translateX(244px)')
    fireEvent.click(btn, { detail: 1 })
    expect(onActivate).toHaveBeenCalledTimes(1)
    // Enter is never held back: a keyboard press is one deliberate activation.
    fireEvent.click(btn, { detail: 0 })
    expect(onActivate).toHaveBeenCalledTimes(2)
    document.removeEventListener('slidecomplete', onComplete)
  })

  it('a short slide springs back and does not activate, not even through the click that follows', () => {
    const onActivate = vi.fn()
    render(<SlideButton label="Continue" onActivate={onActivate} />)
    const btn = screen.getByRole('button', { name: 'Continue' })
    slide(btn, 28, 28 + 100)
    expect(onActivate).not.toHaveBeenCalled()
    expect(btn.querySelector<HTMLElement>('.slide-btn__knob')!.style.transform).toBe('')
    expect(btn.querySelector<HTMLElement>('.slide-btn__label')!.style.opacity).toBe('')
  })

  it('follows the finger and fades the label while dragging', () => {
    render(<SlideButton label="Continue" onActivate={() => undefined} />)
    const btn = screen.getByRole('button', { name: 'Continue' })
    fireEvent.pointerDown(btn, { pointerId: 1, pointerType: 'touch', clientX: 28, clientY: 28 })
    fireEvent.pointerMove(btn, { pointerId: 1, pointerType: 'touch', clientX: 40, clientY: 28 })
    // Touch captures to the pressed element (the knob); taking capture to the button ends that one.
    // That must not end the slide (this stopped every drag in Chromium before).
    fireEvent.lostPointerCapture(btn.querySelector('.slide-btn__knob')!, { pointerId: 1 })
    fireEvent.pointerMove(btn, { pointerId: 1, pointerType: 'touch', clientX: 89, clientY: 28 })
    expect(btn).toHaveClass('is-dragging')
    expect(btn.querySelector<HTMLElement>('.slide-btn__knob')!.style.transform).toBe('translateX(61px)')
    expect(Number(btn.querySelector<HTMLElement>('.slide-btn__label')!.style.opacity)).toBeCloseTo(0.55, 1)
    fireEvent.pointerCancel(btn, { pointerId: 1, pointerType: 'touch' })
    expect(btn).not.toHaveClass('is-dragging')
  })

  it('a vertical move is left to the page scroll', () => {
    const onActivate = vi.fn()
    render(<SlideButton label="Continue" onActivate={onActivate} />)
    const btn = screen.getByRole('button', { name: 'Continue' })
    slide(btn, 28, 30, { dy: 120, cancel: true, noClick: true })
    expect(btn).not.toHaveClass('is-dragging')
    expect(btn.querySelector<HTMLElement>('.slide-btn__knob')!.style.transform).toBe('')
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('mirrors the direction in right-to-left layouts', () => {
    restore()
    restore = stubLayout(true)
    const onActivate = vi.fn()
    render(<SlideButton label="Continue" onActivate={onActivate} />)
    const btn = screen.getByRole('button', { name: 'Continue' })
    slide(btn, 272, 272 + 160)
    expect(onActivate).not.toHaveBeenCalled()
    slide(btn, 272, 272 - 160)
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(btn.querySelector<HTMLElement>('.slide-btn__knob')!.style.transform).toBe('translateX(-244px)')
  })

  it('busy and disabled cannot be tapped or dragged, and disabled says why', () => {
    const onActivate = vi.fn()
    const { rerender } = render(<SlideButton label="Continue" busy onActivate={onActivate} />)
    const btn = screen.getByRole('button', { name: 'Continue' })
    expect(btn).toHaveAttribute('aria-busy', 'true')
    expect(btn).toHaveTextContent('Saving')
    slide(btn, 28, 260)
    fireEvent.click(btn, { detail: 1 })
    expect(onActivate).not.toHaveBeenCalled()
    rerender(<SlideButton label="Continue" disabled disabledReason="Choose an occasion first." onActivate={onActivate} />)
    expect(btn).toHaveAttribute('aria-disabled', 'true')
    expect(btn).toHaveAccessibleDescription('Choose an occasion first.')
    slide(btn, 28, 260)
    fireEvent.click(btn, { detail: 1 })
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('as a submit button, a completed slide submits its form once', () => {
    const onSubmit = vi.fn((e: SubmitEvent) => e.preventDefault())
    render(
      <form onSubmit={(e) => onSubmit(e.nativeEvent as SubmitEvent)}>
        <SlideButton type="submit" label="Continue" />
      </form>,
    )
    const btn = screen.getByRole('button', { name: 'Continue' })
    act(() => slide(btn, 28, 280))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
