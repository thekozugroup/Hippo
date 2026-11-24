// The status area: what sits under a top inset (the Android app's transparent status bar, or a
// Home Screen web app on iPhone). See base.css, "The status area".
//
// - html[data-top-inset] is set only while the page really has a top inset, so an ordinary browser
//   tab draws nothing and runs nothing but one small probe.
// - html[data-under="sheet"] says the light sheet has scrolled up under the status bar, so the
//   fade takes the sheet's colour, and the Android shell turns the status bar icons dark (light
//   theme). It changes with a little hysteresis, so crossing the edge back and forth never flickers.

/** Pixels the sheet must move back below the inset before the area counts as hero again. */
export const UNDER_HYSTERESIS = 6

/**
 * Whether the sheet is under the status bar, given its top edge, the inset and the previous answer.
 * Pure, for tests. The sheet counts as under once its top edge reaches the middle of the inset,
 * where the icons are, and stops counting only once it is clearly below the inset again.
 */
export function sheetUnderStatusBar(sheetTop: number | undefined, insetTop: number, previous: boolean, hysteresis: number = UNDER_HYSTERESIS): boolean {
  if (sheetTop === undefined || !(insetTop > 0)) return false
  const edge = insetTop / 2
  return previous ? sheetTop <= edge + hysteresis : sheetTop <= edge
}

type Listener = (under: boolean) => void
const listeners = new Set<Listener>()
let under = false
let started = false

/** Whether the sheet is under the status bar now. */
export function isSheetUnderStatusBar(): boolean {
  return under
}

/** Called when that changes. Returns a function that stops listening. */
export function onStatusAreaChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** The full-page screen's sheet (never a preview inside the gallery). */
function sheetTop(): number | undefined {
  const sheet = document.querySelector('.screen:not(.screen--contained) > .screen__body .screen__sheet')
  return sheet ? sheet.getBoundingClientRect().top : undefined
}

/** Starts watching. Call once at start, on the website and in the app. */
export function startStatusArea(doc: Document = document): void {
  if (started || typeof ResizeObserver === 'undefined') return
  started = true
  const root = doc.documentElement
  const probe = doc.createElement('div')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:var(--inset-top);visibility:hidden;pointer-events:none'
  doc.body.append(probe)
  let inset = 0
  let frame = 0
  let stopWatching: (() => void) | undefined

  const update = () => {
    frame = 0
    const next = sheetUnderStatusBar(sheetTop(), inset, under)
    if (next === under) return
    under = next
    if (under) root.dataset.under = 'sheet'
    else delete root.dataset.under
    for (const fn of listeners) fn(under)
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update)
  }

  const watch = () => {
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    window.addEventListener('hashchange', schedule)
    window.addEventListener('popstate', schedule)
    // Screens change without a scroll (a route change scrolls to the top before paint).
    const mo = new MutationObserver(schedule)
    const app = doc.getElementById('root') ?? doc.body
    mo.observe(app, { childList: true, subtree: true })
    schedule()
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('hashchange', schedule)
      window.removeEventListener('popstate', schedule)
      mo.disconnect()
    }
  }

  const measure = () => {
    inset = probe.getBoundingClientRect().height
    if (inset > 0) {
      root.dataset.topInset = ''
      stopWatching ??= watch()
      schedule()
    } else {
      delete root.dataset.topInset
      stopWatching?.()
      stopWatching = undefined
      if (under) {
        under = false
        delete root.dataset.under
        for (const fn of listeners) fn(false)
      }
    }
  }
  // The probe's height follows the inset (Capacitor sets --safe-area-inset-* after start; rotation changes it).
  new ResizeObserver(measure).observe(probe)
  measure()
}
