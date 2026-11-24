// Haptic feedback in the app, for a few meaningful moments only: a gift
// marked, a switch turned, a destructive action confirmed, a slide control
// pulled to its end. The tap goes
// through the app's TouchFeedback plugin, which uses the view's
// performHapticFeedback: Android skips it when the person turned touch
// feedback off, and it needs no vibration permission. Nothing happens under
// reduced motion.

import type { HapticKind } from './index.ts'
import { TouchFeedback } from './plugins.ts'

function reducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export function haptic(kind: HapticKind): void {
  if (reducedMotion()) return
  void TouchFeedback.perform({ kind }).catch(() => undefined)
}

/** Which moment, if any, an event is: a switch turned, or a danger button pressed inside an open sheet (the confirmation). Pure, for tests. */
export function hapticFor(event: { type: string; target: EventTarget | null }): HapticKind | undefined {
  const el = event.target
  if (!(el instanceof Element)) return undefined
  // A slide control (SlideButton) pulled to its end: one light confirmation.
  if (event.type === 'slidecomplete') return 'confirm'
  if (event.type === 'change' && el instanceof HTMLInputElement && el.getAttribute('role') === 'switch') return 'toggle'
  if (event.type === 'click') {
    const button = el.closest('button.btn--danger')
    if (button instanceof HTMLButtonElement && !button.disabled && button.closest('dialog[open]')) return 'warning'
  }
  return undefined
}

/** Listens for switches and confirmations anywhere in the document. Returns a function that stops listening. */
export function wireFeedback(doc: Document = document): () => void {
  const on = (e: Event) => {
    const kind = hapticFor(e)
    if (kind) haptic(kind)
  }
  doc.addEventListener('change', on, true)
  doc.addEventListener('click', on, true)
  doc.addEventListener('slidecomplete', on, true)
  return () => {
    doc.removeEventListener('slidecomplete', on, true)
    doc.removeEventListener('change', on, true)
    doc.removeEventListener('click', on, true)
  }
}
