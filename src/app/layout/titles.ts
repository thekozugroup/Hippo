// Document titles per route (WCAG 2.4.2). Titles are fixed strings: they
// never include list names, share-link data or anything else from content
// someone else could control.

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
  [/^\/design$/, 'Design gallery'],
]

export function titleFor(path: string): string {
  const match = ROUTES.find(([re]) => re.test(path))
  return (match ? match[1] : 'Page not found') + SUFFIX
}

export function pageTitle(name: string): string {
  return name + SUFFIX
}
