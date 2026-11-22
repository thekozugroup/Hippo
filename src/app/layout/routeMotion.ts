// Which way a route change should move. Pure, so it is unit tested; the
// router (motionLocation.ts) applies it with the View Transitions API.
//
// forward: going deeper (a list to one of its wishes, Home to an editor), or the
//          next onboarding step; content enters from the end side.
// back:    the reverse, including browser Back; content enters from the start side.
// lateral: switching between bottom-navigation destinations; a quick cross-fade.
// none:    replacing the current entry (redirects), the first render, or no change.

export type NavDirection = 'forward' | 'back' | 'lateral' | 'none'

/** push: a link or navigate(); pop-back / pop-forward: browser history; replace: a redirect. */
export type NavKind = 'push' | 'pop-back' | 'pop-forward' | 'replace' | 'initial'

/** Bottom-navigation destinations, in their visual order. */
export const TAB_PATHS: readonly string[] = ['/', '/wishlist', '/lists', '/settings']

/** Onboarding steps, in order (the path is `/welcome/<step>`). */
export const WELCOME_STEPS = ['start', 'name', 'occasion', 'wish', 'capture'] as const
export type WelcomeStep = (typeof WELCOME_STEPS)[number]

export interface RouteInfo {
  /** 0 for bottom-navigation destinations, 1 for anything opened from them. */
  level: number
  tab?: number
  step?: number
}

export function routeInfo(path: string): RouteInfo {
  const clean = path.split('?')[0] ?? '/'
  const tab = TAB_PATHS.indexOf(clean)
  if (tab >= 0) return { level: 0, tab }
  const m = /^\/welcome\/([a-z]+)$/.exec(clean)
  if (m) {
    const step = (WELCOME_STEPS as readonly string[]).indexOf(m[1] ?? '')
    if (step >= 0) return { level: 1, step }
  }
  return { level: 1 }
}

export function directionFor(from: string, to: string, kind: NavKind): NavDirection {
  if (kind === 'replace' || kind === 'initial' || from === to) return 'none'
  const a = routeInfo(from)
  const b = routeInfo(to)
  if (a.tab !== undefined && b.tab !== undefined) return 'lateral'
  if (a.step !== undefined && b.step !== undefined) return b.step > a.step ? 'forward' : 'back'
  if (kind === 'pop-back') return 'back'
  if (kind === 'pop-forward') return 'forward'
  if (b.level > a.level) return 'forward'
  if (b.level < a.level) return 'back'
  return 'forward'
}
