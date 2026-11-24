// "Open in the app" on phones: whether to offer it, and whether Hippo is already installed here.
//
// - Android browsers (not inside another app's web view, not Hippo running installed, not the
//   Android app): an intent link to the Hippo Android app is always offered, quietly. It needs no
//   verification and falls back to the same page when the app is not installed (lib/app-route.ts).
// - Where Chrome can tell (getInstalledRelatedApps, Chrome on Android; see related-apps.ts for what
//   the site declares): the installed web app or the Android app is reported, and setup and the Home
//   checklist offer "Open in the app" instead of asking to install again. A browser tab cannot open
//   an installed web app by itself, so for the web app Hippo only says where to find it.
// - iPhone and iPad: there is no Hippo app, and a Home Screen web app can be neither detected nor
//   opened from Safari, so nothing is offered there.

import { useEffect, useState } from 'react'
import { isNativeApp } from '../native/platform.ts'
import { ANDROID_PACKAGE, openInAppHref, type AppRoute } from '../lib/app-route.ts'
import type { InstallGuide } from './guide.ts'

/** Where the Android intent link may be offered: an Android browser that is not an in-app view and not Hippo itself. */
export function offersOpenInApp(g: Pick<InstallGuide, 'platform' | 'kind'>, native: boolean = isNativeApp()): boolean {
  return !native && g.platform === 'android' && g.kind !== 'installed' && g.kind !== 'in-app'
}

export interface InstalledHere {
  /** Hippo's web app is installed (reported for pages within its scope). */
  webApp: boolean
  /** The Hippo Android app is installed (reported only with a verified association). */
  androidApp: boolean
}

interface RelatedApp {
  platform?: unknown
  id?: unknown
}

type RelatedNavigator = Navigator & { getInstalledRelatedApps?: () => Promise<RelatedApp[]> }

/** What getInstalledRelatedApps returned, as two plain answers. Pure, for tests. */
export function readRelatedApps(apps: unknown): InstalledHere {
  const list = Array.isArray(apps) ? (apps as RelatedApp[]) : []
  return {
    webApp: list.some((a) => a?.platform === 'webapp'),
    androidApp: list.some((a) => a?.platform === 'play' && a.id === ANDROID_PACKAGE),
  }
}

let asked: Promise<InstalledHere | null> | null = null

/** Asks the browser once per page; null where the API does not exist or fails. */
export function installedRelatedApps(nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator): Promise<InstalledHere | null> {
  if (asked) return asked
  const fn = (nav as RelatedNavigator | undefined)?.getInstalledRelatedApps
  asked =
    typeof fn === 'function' && !isNativeApp()
      ? fn
          .call(nav)
          .then(readRelatedApps)
          .catch(() => null)
      : Promise.resolve(null)
  return asked
}

/** For tests: forget the cached answer. */
export function resetInstalledRelatedApps(): void {
  asked = null
}

/** The browser's answer on whether Hippo is installed here; null until known, or where it cannot tell. */
export function useInstalledHere(enabled: boolean): InstalledHere | null {
  const [state, setState] = useState<InstalledHere | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    void installedRelatedApps().then((r) => {
      if (live) setState(r)
    })
    return () => {
      live = false
    }
  }, [enabled])
  return state
}

/** The intent link for `route`, falling back to this page as it is now (its address never holds a secret). */
export function openInAppLink(route: AppRoute): string {
  return openInAppHref(route, window.location.href)
}
