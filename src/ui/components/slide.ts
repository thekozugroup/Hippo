// Pure decisions for SlideButton's drag, kept apart so they are tested without a DOM.

/** How far (CSS px) a finger or mouse must move before a press becomes a drag or a scroll. */
export const SLIDE_SLOP = 8
/** Share of the track the knob must cross for a release to complete the slide. */
export const SLIDE_THRESHOLD = 0.6

export type DragIntent = 'undecided' | 'slide' | 'scroll'

/**
 * What a press that has moved by (dx, dy) is turning into. `dx` is measured along the slide's own
 * direction (positive toward the end, so already mirrored for right-to-left). A mostly vertical
 * move is a page scroll; a mostly horizontal one is a slide, even if it starts backwards.
 */
export function dragIntent(dx: number, dy: number, slop: number = SLIDE_SLOP): DragIntent {
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (ax < slop && ay < slop) return 'undecided'
  return ax > ay ? 'slide' : 'scroll'
}

/** The knob's offset for a move of `dx` along the track: never before the start, never past `max`. */
export function knobOffset(dx: number, max: number): number {
  if (!(max > 0) || !Number.isFinite(dx)) return 0
  return Math.min(max, Math.max(0, dx))
}

/** How far along the track the knob is, 0 to 1. */
export function slideProgress(offset: number, max: number): number {
  if (!(max > 0) || !Number.isFinite(offset)) return 0
  return Math.min(1, Math.max(0, offset / max))
}

/** True when releasing at `progress` completes the slide. */
export function completesAt(progress: number, threshold: number = SLIDE_THRESHOLD): boolean {
  return progress >= threshold
}

/** The label fades as the knob covers it: fully gone a little before the threshold. */
export function labelOpacity(progress: number): number {
  return Math.max(0, Math.min(1, 1 - progress * 1.8))
}

/**
 * True when a press is a further tap of a multi-tap whose earlier tap this same control already
 * acted on (`taps` is the click's tap count; `lastTaps` that of this control's last activation,
 * undefined when it has none). A double tap is one intent; a single press never repeats one.
 */
export function isRepeatPress(taps: number, lastTaps: number | undefined): boolean {
  return taps > 1 && lastTaps !== undefined && lastTaps < taps
}
