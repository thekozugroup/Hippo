// Hash routing with route transitions. A drop-in for wouter's hash location
// hook: it follows `#/path` changes from links, navigate() and browser
// history, works out whether the change is a push, a Back or a Forward (each
// history entry carries an index in history.state), and renders the change
// inside `document.startViewTransition` so the CSS in ui/styles/motion.css
// can move the page in the right direction.
//
// Rules it keeps:
// - The URL is the source of truth: the screen always ends on the latest
//   address, however fast people tap or go back (a newer transition skips
//   the running one, whose update still runs and renders the latest path).
// - Nothing waits on the animation: the new screen is live and takes input
//   at once (::view-transition has pointer-events: none).
// - No transition for redirects (replace), when the browser lacks the API,
//   when the tab is hidden, or under prefers-reduced-motion.

import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { directionFor, type NavDirection, type NavKind } from './routeMotion.ts'

const IDX = 'hippoIdx'
/** Longest wait for a lazy screen's code before the transition goes ahead anyway. */
const PRELOAD_WAIT_MS = 250
/** If a transition's update never runs (it always should), render anyway after this long. */
const STUCK_MS = 1500

type Listener = () => void
const listeners = new Set<Listener>()

let started = false
let index = 0
/** The address last seen, with its `?query` (dedupes repeated events). */
let seen = '/'
/** While a transition captures the old screen, the snapshot to keep rendering; null otherwise. */
let held: string | null = null
/**
 * Bumped when a quick A -> B -> A lands back on the screen still on display before B ever
 * rendered: the screen is then mounted afresh, as if B had been shown (no stale form state).
 */
let epoch = 0
let committed = '/'
let navigatedSinceCommit = false
let token = 0
let pending: { idx: number; path: string } | null = null
let preload: (path: string) => Promise<unknown> | undefined = () => undefined
/** The transition on screen, if any. */
let running: ViewTransition | null = null

const INTERACTIVE = 'a[href], button, input, select, textarea, label, summary, [role="button"], [role="link"]'

/**
 * While a transition plays, the browser hit-tests its snapshot layer, so a tap lands on <html>
 * and would be lost. Such a tap ends the transition at once and is replayed on the real control
 * under the finger, so motion never swallows input (a second tap on the navigation, say).
 */
function replayTapDuringTransition(e: MouseEvent): void {
  const t = running
  if (!t || e.target !== document.documentElement || !e.isTrusted) return
  e.preventDefault()
  e.stopPropagation()
  const { clientX: x, clientY: y } = e
  t.skipTransition()
  const replay = () =>
    window.requestAnimationFrame(() => {
      const hit = document.elementFromPoint(x, y)
      const control = hit instanceof Element ? hit.closest<HTMLElement>(INTERACTIVE) : null
      if (!control) return
      if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) {
        control.focus()
        if (control instanceof HTMLInputElement && (control.type === 'radio' || control.type === 'checkbox')) control.click()
      } else control.click()
    })
  t.finished.then(replay, replay)
}

function hashPath(): string {
  return '/' + window.location.hash.replace(/^#?\/?/, '')
}

function pathOnly(p: string): string {
  return p.split('?')[0] ?? '/'
}

function readIdx(state: unknown): number | undefined {
  if (typeof state !== 'object' || state === null) return undefined
  const v = (state as Record<string, unknown>)[IDX]
  return typeof v === 'number' && Number.isSafeInteger(v) ? v : undefined
}

function withIdx(state: unknown, idx: number): Record<string, unknown> {
  return { ...(typeof state === 'object' && state !== null ? (state as Record<string, unknown>) : {}), [IDX]: idx }
}

function emit(): void {
  for (const l of listeners) l()
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function canTransition(): boolean {
  return typeof document.startViewTransition === 'function' && document.visibilityState === 'visible' && !reducedMotion()
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function snapshotFor(path: string): string {
  return `${epoch}|${path}`
}

/** Renders the latest address. */
function commit(): void {
  const path = hashPath()
  if (navigatedSinceCommit && path === committed) epoch += 1
  committed = path
  navigatedSinceCommit = false
  held = null
  emit()
}

function render(shownBefore: string, to: string, dir: NavDirection): void {
  navigatedSinceCommit = true
  if (dir === 'none' || !canTransition()) {
    token += 1
    commit()
    return
  }
  const my = ++token
  held ??= snapshotFor(shownBefore)
  const root = document.documentElement
  root.dataset.navDir = dir
  if (window.scrollY > 40) root.dataset.navScrolled = ''
  else delete root.dataset.navScrolled

  let updated = false
  const update = async () => {
    // Give a lazy screen a moment to load so the transition lands on it, not on a placeholder.
    const loading = preload(pathOnly(to))
    if (loading) await Promise.race([loading.catch(() => undefined), delay(PRELOAD_WAIT_MS)])
    updated = true
    // A newer transition (a quick second tap, Back mid-transition) renders the latest address.
    if (my !== token) return
    flushSync(commit)
  }
  const transition = document.startViewTransition(update)
  running = transition
  const settle = () => {
    if (running === transition) running = null
    if (my !== token) return
    delete root.dataset.navDir
    delete root.dataset.navScrolled
  }
  transition.finished.then(settle, settle)
  transition.ready.catch(() => undefined)
  transition.updateCallbackDone.catch(() => undefined)
  setTimeout(() => {
    if (!updated && my === token) commit()
  }, STUCK_MS)
}

function handle(from: string, to: string, kind: NavKind, force?: NavDirection): void {
  const shownBefore = held === null ? from : held.slice(held.indexOf('|') + 1)
  render(shownBefore, to, force ?? directionFor(pathOnly(shownBefore), pathOnly(to), kind))
}

function onHistoryChange(): void {
  const to = hashPath()
  const state = window.history.state
  const idx = readIdx(state)
  if (pending && idx === pending.idx) {
    // Arrived back at the entry a flow started from: swap it for the destination.
    const target = pending.path
    pending = null
    const from = seen
    window.history.replaceState(withIdx(state, idx), '', urlFor(target))
    index = idx
    seen = hashPath()
    handle(from, seen, 'push', 'forward')
    return
  }
  if (to === seen) return
  const from = seen
  seen = to
  let kind: NavKind
  if (idx === undefined) {
    index += 1
    window.history.replaceState(withIdx(state, index), '')
    kind = 'push'
  } else {
    kind = idx < index ? 'pop-back' : idx > index ? 'pop-forward' : 'replace'
    index = idx
  }
  handle(from, to, kind)
}

function ensureStarted(): void {
  if (started || typeof window === 'undefined') return
  started = true
  const idx = readIdx(window.history.state)
  if (idx === undefined) window.history.replaceState(withIdx(window.history.state, 0), '')
  index = idx ?? 0
  seen = hashPath()
  committed = seen
  window.addEventListener('hashchange', onHistoryChange)
  window.addEventListener('popstate', onHistoryChange)
  window.addEventListener('click', replayTapDuringTransition, true)
}

function urlFor(to: string): string {
  const url = new URL(window.location.href)
  url.hash = '/' + to.replace(/^#?\/?/, '')
  return url.href
}

/** Goes to `to` (a path such as `/wishlist`), as a new history entry or replacing this one. */
export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  ensureStarted()
  const href = urlFor(to)
  const from = seen
  if (opts.replace) {
    window.history.replaceState(withIdx(window.history.state, index), '', href)
  } else {
    if (href === window.location.href) return
    index += 1
    window.history.pushState(withIdx(null, index), '', href)
  }
  seen = hashPath()
  handle(from, seen, opts.replace ? 'replace' : 'push')
}

/** Index of the current history entry (0 for the first entry this app saw in this tab). */
export function historyIndex(): number {
  ensureStarted()
  return index
}

/**
 * Leaves a flow: goes back through history to entry `idx` (where the flow
 * started) and replaces it with `path`, so Back afterwards does not return
 * into the flow. Falls back to replacing the current entry.
 */
export function returnTo(idx: number, path: string): void {
  ensureStarted()
  if (idx >= index || idx < 0) {
    navigate(path, { replace: true })
    return
  }
  pending = { idx, path }
  window.history.go(idx - index)
  setTimeout(() => {
    if (pending && pending.idx === idx) {
      pending = null
      navigate(path, { replace: true })
    }
  }, 1000)
}

/** Lets the app load a lazy screen's code before a transition shows it. */
export function setRoutePreloader(fn: (path: string) => Promise<unknown> | undefined): void {
  preload = fn
}

function subscribe(listener: Listener): () => void {
  ensureStarted()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(): string {
  return held ?? snapshotFor(hashPath())
}

function useSnapshot(): string {
  return useSyncExternalStore(subscribe, snapshot, () => '0|/')
}

/** wouter location hook: the current path (a `?query` inside the fragment is ignored) and navigate. */
export function useMotionLocation(): [string, (to: string, opts?: { replace?: boolean }) => void] {
  const snap = useSnapshot()
  return [pathOnly(snap.slice(snap.indexOf('|') + 1)), navigate]
}

/** Changes when the screen on display must be mounted afresh (see `epoch`); use as the routes' key. */
export function useRouteEpoch(): number {
  const snap = useSnapshot()
  return Number(snap.slice(0, snap.indexOf('|')))
}
useMotionLocation.hrefs = (href: string): string => '#' + href
