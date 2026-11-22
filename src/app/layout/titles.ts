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
  [/^\/welcome\/start$/, 'Welcome, step 1 of 5'],
  [/^\/welcome\/name$/, 'Your name, step 2 of 5'],
  [/^\/welcome\/occasion$/, 'The occasion, step 3 of 5'],
  [/^\/welcome\/wish$/, 'Your first wish, step 4 of 5'],
  [/^\/welcome\/capture$/, 'Add wishes from anywhere, step 5 of 5'],
]

export function titleFor(path: string): string {
  const match = ROUTES.find(([re]) => re.test(path))
  return (match ? match[1] : 'Page not found') + SUFFIX
}

export function pageTitle(name: string): string {
  return name + SUFFIX
}
