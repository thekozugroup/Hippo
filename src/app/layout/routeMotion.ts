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

/**
 * Every onboarding step (the path is `/welcome/<step>`). Saved progress stores a step's index in
 * this list, so new steps are only ever appended. The order a person sees is `welcomeOrder()`.
 */
export const WELCOME_STEPS = ['start', 'name', 'occasion', 'wish', 'capture', 'install'] as const
export type WelcomeStep = (typeof WELCOME_STEPS)[number]

let order: readonly WelcomeStep[] = ['start', 'name', 'occasion', 'wish', 'capture']

/** The steps in the order shown on this device: set once at start from where installing fits (without an install step until then). */
export function welcomeOrder(): readonly WelcomeStep[] {
  return order
}

export function setWelcomeOrder(steps: readonly WelcomeStep[]): void {
  order = steps
}

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
    const step = (order as readonly string[]).indexOf(m[1] ?? '')
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
