// Window size classes (DESIGN.md section 5, "Adaptive layout"). CSS cannot read custom properties in
// a media query and the build has no custom-media step, so every stylesheet writes the same two
// queries out in full; src/ui/layout.test.ts fails when one of them differs from the strings here.
//
// - compact: phones, and anything narrower than 45em (720px at the default text size). Exactly the
//   phone layout: one 480px column, the floating bottom navigation.
// - medium: 45em and wider (tablets, an unfolded foldable, small windows): a side rail.
// - expanded: 67.5em and wider (1080px): a full sidebar and two-column screens.
//
// The widths are in em, so a larger text size moves a window toward the compact layout (200% text in
// a 1280px window is compact). A touch screen that is also short (a phone on its side: no hover and
// less than 32em tall) stays compact, so the Android app and phones in landscape keep the phone layout.

import { useSyncExternalStore } from 'react'

/** Medium and wider. */
export const MEDIUM_QUERY = '(min-width: 45em) and ((hover: hover) or (min-height: 32em))'
/** Expanded. */
export const EXPANDED_QUERY = '(min-width: 67.5em) and ((hover: hover) or (min-height: 32em))'

export type LayoutSize = 'compact' | 'medium' | 'expanded'

function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
}

/** The current size class. */
export function layoutSize(): LayoutSize {
  if (matches(EXPANDED_QUERY)) return 'expanded'
  if (matches(MEDIUM_QUERY)) return 'medium'
  return 'compact'
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined
  const lists = [window.matchMedia(MEDIUM_QUERY), window.matchMedia(EXPANDED_QUERY)]
  for (const l of lists) l.addEventListener?.('change', onChange)
  return () => {
    for (const l of lists) l.removeEventListener?.('change', onChange)
  }
}

/** The size class, kept current as the window is resized. Layout itself is CSS; use this only for behaviour. */
export function useLayoutSize(): LayoutSize {
  return useSyncExternalStore(subscribe, layoutSize, () => 'compact')
}
