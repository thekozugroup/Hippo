import { describe, expect, it } from 'vitest'
import { ANDROID_PACKAGE, HOME_ROUTE, appRouteFromOpenUrl, openInAppHref, parseAppRoute, routePath } from './app-route.ts'

const PAYLOAD = 'AaoSdRv2qL_BwIuTHzKr-24jPw4kQwejV2KnSdnV1Qy2h7D8Z4TksfA5zKUHctWzosoMr_GnpMTG1tXdkkeG_0M'

describe('the routes a browser may hand to the app', () => {
  it('accepts the destinations, a shared list and a transfer', () => {
    for (const path of ['/', '/wishlist', '/lists', '/settings'] as const) expect(parseAppRoute(path)).toEqual({ kind: 'destination', path })
    expect(parseAppRoute(`/l/${PAYLOAD}`)).toEqual({ kind: 'list', payload: PAYLOAD })
    expect(parseAppRoute(`/t/${PAYLOAD}`)).toEqual({ kind: 'transfer', payload: PAYLOAD })
  })

  it('opens Home for anything else', () => {
    for (const bad of ['', '/item/new', '/item/abc', '/list/abc', '/g/topic', '/l/', '/l/a/b', '/l/a b', '/l/a%2Fb', '/t/../x', '/welcome/start', '/lists/', 'lists', '/l/' + 'a'.repeat(4097), 42, null, undefined]) {
      expect(parseAppRoute(bad)).toEqual(HOME_ROUTE)
    }
  })

  it('reads hippo://open/<route> and nothing looser', () => {
    expect(appRouteFromOpenUrl('hippo://open/lists')).toEqual({ kind: 'destination', path: '/lists' })
    expect(appRouteFromOpenUrl('hippo://open')).toEqual(HOME_ROUTE)
    expect(appRouteFromOpenUrl(`hippo://open/l/${PAYLOAD}`)).toEqual({ kind: 'list', payload: PAYLOAD })
    expect(appRouteFromOpenUrl('HIPPO://OPEN/settings')).toEqual({ kind: 'destination', path: '/settings' })
    for (const odd of ['hippo://open/lists?x=1', 'hippo://open/lists#top', 'hippo://evil/lists', 'hippo://user@open/lists', 'hippo://open:1/lists', 'hippo:open', 'hippo://open/item/new']) {
      expect(appRouteFromOpenUrl(odd)).toEqual(HOME_ROUTE)
    }
  })

  it('leaves other addresses to the other handlers', () => {
    expect(appRouteFromOpenUrl(`https://owner.github.io/Hippo/#/l/${PAYLOAD}`)).toBeNull()
    expect(appRouteFromOpenUrl('hippopotamus://open/')).toBeNull()
    expect(appRouteFromOpenUrl(undefined)).toBeNull()
  })

  it('writes the path back as the router knows it', () => {
    expect(routePath({ kind: 'list', payload: PAYLOAD })).toBe(`/l/${PAYLOAD}`)
    expect(routePath({ kind: 'transfer', payload: PAYLOAD })).toBe(`/t/${PAYLOAD}`)
    expect(routePath(HOME_ROUTE)).toBe('/')
  })
})

describe('the intent link', () => {
  it('names the package and scheme, carries only the route, and falls back to the same page', () => {
    const href = openInAppHref({ kind: 'list', payload: PAYLOAD }, 'https://owner.github.io/Hippo/#/g/abc')
    expect(href).toBe(
      `intent://open/l/${PAYLOAD}#Intent;scheme=hippo;package=${ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent('https://owner.github.io/Hippo/#/g/abc')};end`,
    )
    expect(openInAppHref(HOME_ROUTE, 'https://hippo.example/#/')).toMatch(/^intent:\/\/open\/#Intent;scheme=hippo;package=io\.github\.thekozugroup\.hippo;S\.browser_fallback_url=https%3A%2F%2Fhippo\.example%2F%23%2F;end$/)
  })

  it('has no fallback unless it is a web address', () => {
    expect(openInAppHref(HOME_ROUTE, 'javascript:alert(1)')).not.toContain('browser_fallback_url')
    expect(openInAppHref(HOME_ROUTE, 'not a url')).not.toContain('browser_fallback_url')
  })
})
