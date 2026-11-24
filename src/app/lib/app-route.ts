// "Open in the Hippo app": the one route a web page may hand to the Android app, and the one
// validated way in.
//
// The website (on an Android browser) offers an Android intent link that names the app's package
// and its custom scheme, carrying only the route on screen: `hippo://open/<route>`. When the app is
// installed Android opens it there; when it is not, the browser follows the fallback, which is the
// same page, so nothing breaks. No verification is needed for this (unlike opening https links in
// the app, or detecting the app from the page).
//
// The app accepts only these route shapes; anything else opens Home:
//   /  /wishlist  /lists  /settings      a destination
//   /l/<payload>                         a shared list (the payload holds the list's key)
//   /t/<payload>                         a transfer (the payload holds the secret to every list)
// A payload is checked for its alphabet and length only here; the screens validate it fully, as for
// any share or transfer link. A payload is a secret: it is never logged, and the app keeps it out
// of the address bar and history exactly as it does for links (GiverLinkScreen, transfer-inbox.ts).
// The same rules are in android/app/src/main/java/io/github/thekozugroup/hippo/OpenRoute.java.

/** The Android app's package (android/app/build.gradle, applicationId). */
export const ANDROID_PACKAGE = 'io.github.thekozugroup.hippo'
/** The custom scheme the app registers (AndroidManifest.xml) and its one host. */
export const APP_SCHEME = 'hippo'
export const APP_HOST = 'open'

const DESTINATIONS = ['/', '/wishlist', '/lists', '/settings'] as const
export type Destination = (typeof DESTINATIONS)[number]

export type AppRoute = { kind: 'destination'; path: Destination } | { kind: 'list'; payload: string } | { kind: 'transfer'; payload: string }

export const HOME_ROUTE: AppRoute = { kind: 'destination', path: '/' }

const PAYLOAD = /^[A-Za-z0-9_-]{1,4096}$/
const MAX_URL = 8192

function isDestination(path: string): path is Destination {
  return (DESTINATIONS as readonly string[]).includes(path)
}

/** A route path (`/lists`, `/l/<payload>`) as an `AppRoute`; anything not on the list is Home. */
export function parseAppRoute(path: unknown): AppRoute {
  if (typeof path !== 'string' || path.length > MAX_URL) return HOME_ROUTE
  if (isDestination(path)) return { kind: 'destination', path }
  const m = /^\/(l|t)\/([^/?#]*)$/.exec(path)
  if (m?.[2] && PAYLOAD.test(m[2])) return m[1] === 'l' ? { kind: 'list', payload: m[2] } : { kind: 'transfer', payload: m[2] }
  return HOME_ROUTE
}

/** The path for a route, as the router knows it. */
export function routePath(r: AppRoute): string {
  if (r.kind === 'destination') return r.path
  return `/${r.kind === 'list' ? 'l' : 't'}/${r.payload}`
}

/**
 * The route in a `hippo://open/<route>` address (what Android hands the app), or null when the
 * address is not one (then it is some other link, handled elsewhere). A `hippo:` address that is
 * malformed, has a query, a fragment, a user or a port, or an unknown route, opens Home.
 */
export function appRouteFromOpenUrl(url: unknown): AppRoute | null {
  if (typeof url !== 'string' || !/^hippo:/i.test(url)) return null
  if (url.length > MAX_URL) return HOME_ROUTE
  const m = /^hippo:\/\/open(\/[^?#]*)?$/i.exec(url)
  if (!m) return HOME_ROUTE
  return parseAppRoute(m[1] ?? '/')
}

/**
 * An Android intent link that opens `route` in the Hippo app, or, when the app is not installed,
 * goes to `fallback` (the page it was offered on, which must be an http or https address without a
 * secret in it). Chrome, Samsung Internet and most Android browsers follow these from a user's tap.
 */
export function openInAppHref(route: AppRoute, fallback: string): string {
  let fb = ''
  try {
    const u = new URL(fallback)
    if (u.protocol === 'https:' || u.protocol === 'http:') fb = u.href
  } catch {
    // Not a web address: no fallback.
  }
  const path = routePath(route)
  return `intent://${APP_HOST}${path}#Intent;scheme=${APP_SCHEME};package=${ANDROID_PACKAGE};${fb ? `S.browser_fallback_url=${encodeURIComponent(fb)};` : ''}end`
}
