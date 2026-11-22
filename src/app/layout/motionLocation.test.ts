import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { historyIndex, navigate, returnTo, useMotionLocation, useRouteEpoch } from './motionLocation.ts'

// jsdom has no View Transitions; record what the router asks for instead.
const dirs: string[] = []
beforeAll(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: (update: () => Promise<void> | void) => {
      dirs.push(document.documentElement.dataset.navDir ?? 'none')
      const done = Promise.resolve().then(update)
      return { finished: done, ready: done, updateCallbackDone: done, skipTransition: () => undefined }
    },
  })
})
afterEach(() => {
  dirs.length = 0
})

const settle = () => new Promise((r) => setTimeout(r, 0))
const waitForHash = (hash: string) => vi.waitFor(() => expect(window.location.hash).toBe(hash))

describe('router history and transitions', () => {
  it('judges a quick second tap from what is on screen, not from the half-finished one', () => {
    navigate('/lists', { replace: true })
    navigate('/list/x')
    navigate('/wishlist') // the list screen has not rendered yet: Lists -> Wishlist is lateral
    expect(dirs).toEqual(['forward', 'lateral'])
  })

  it('numbers entries, animates pushes by depth and history by its direction, and skips redirects', async () => {
    navigate('/wishlist', { replace: true })
    const base = historyIndex()
    navigate('/item/abc')
    expect(historyIndex()).toBe(base + 1)
    await settle()
    navigate('/settings')
    navigate('/settings') // same address again: no new entry
    expect(historyIndex()).toBe(base + 2)
    navigate('/item/new', { replace: true })
    expect(historyIndex()).toBe(base + 2)
    expect(dirs).toEqual(['forward', 'back'])

    window.history.back()
    await waitForHash('#/item/abc')
    await vi.waitFor(() => expect(dirs).toEqual(['forward', 'back', 'back']))
    expect(historyIndex()).toBe(base + 1)
    window.history.forward()
    await waitForHash('#/item/new')
    await vi.waitFor(() => expect(dirs.at(-1)).toBe('forward'))
  })

  it('remounts the screen on display when a quick A -> B -> A lands back on it, and only then', async () => {
    navigate('/wishlist', { replace: true })
    await settle()
    const { result } = renderHook(() => ({ epoch: useRouteEpoch(), path: useMotionLocation()[0] }))
    const start = result.current.epoch
    await act(async () => {
      navigate('/item/a')
      navigate('/wishlist') // before the item screen ever rendered
      await settle()
    })
    expect(result.current).toEqual({ epoch: start + 1, path: '/wishlist' })
    await act(async () => {
      navigate('/lists')
      await settle()
    })
    expect(result.current).toEqual({ epoch: start + 1, path: '/lists' })
  })

  it('returns to where a flow started and replaces that entry', async () => {
    navigate('/settings')
    const start = historyIndex()
    navigate('/welcome/start')
    navigate('/welcome/name')
    navigate('/welcome/occasion')
    returnTo(start + 1, '/')
    await waitForHash('#/')
    expect(historyIndex()).toBe(start + 1)
    window.history.back()
    await waitForHash('#/settings')
  })
})
