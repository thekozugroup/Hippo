// Document titles per route (WCAG 2.4.2). Titles are fixed strings: they
// never include list names, share-link data or anything else from content
// someone else could control.

import { welcomeOrder, type WelcomeStep } from './routeMotion.ts'

const SUFFIX = ' - Hippo'

const ROUTES: ReadonlyArray<[RegExp, string]> = [
  [/^\/$/, 'Home'],
  [/^\/wishlist$/, 'Wishlist'],
  [/^\/item\/new$/, 'Add a wish'],
  [/^\/item\/[^/]+$/, 'Edit wish'],
  [/^\/lists$/, 'Lists'],
  [/^\/list\/new$/, 'New list'],
  [/^\/list\/[^/]+$/, 'Your list'],
  [/^\/l\/[^/]+$/, 'Opening a shared list'],
  [/^\/g\/[^/]+$/, 'Shared list'],
  [/^\/settings$/, 'Settings'],
  [/^\/existing$/, 'Bring your Hippo here'],
  [/^\/move$/, 'Move to another device'],
  [/^\/move\/receive$/, 'Receive from another device'],
  [/^\/t\/[^/]+$/, 'Opening a transfer link'],
  [/^\/site$/, 'Your Hippo site'],
  [/^\/design$/, 'Design gallery'],
]

const STEP_TITLES: Record<WelcomeStep, string> = {
  start: 'Welcome',
  install: 'Install Hippo',
  name: 'Your name',
  occasion: 'The occasion',
  wish: 'Your first wish',
  capture: 'Add wishes from anywhere',
}

export function titleFor(path: string): string {
  const step = /^\/welcome\/([a-z]+)$/.exec(path)?.[1]
  const steps = welcomeOrder()
  const at = steps.findIndex((s) => s === step)
  const current = steps[at]
  if (current) return `${STEP_TITLES[current]}, step ${at + 1} of ${steps.length}${SUFFIX}`
  const match = ROUTES.find(([re]) => re.test(path))
  return (match ? match[1] : 'Page not found') + SUFFIX
}

export function pageTitle(name: string): string {
  return name + SUFFIX
}
