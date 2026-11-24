// The Hippo website the app's links point at, and whether it answers. Inside the Android app the
// links point at a public website (built in, or chosen under Settings). Before a list link is shown
// or shared, the app checks once per session that the site answers; if it does not, a plain line
// beside the link says so. Sharing is never blocked on it. On the website this is all inert.

import { useEffect, useState, useSyncExternalStore } from 'react'
import { isNativeApp, siteFileFetcher } from '../native/index.ts'
import { checkSite } from './site-check.ts'
import { chosenSite, onSiteChange, siteAddress } from './site-address.ts'

export type Reach = 'unknown' | 'ok' | 'unreachable'

let checked: { site: string; result: Promise<Reach> } | undefined

/** Once per session per address: does the site answer as a Hippo site? */
export function siteReach(): Promise<Reach> {
  const site = siteAddress()
  const fetchFile = siteFileFetcher()
  if (!fetchFile || !site) return Promise.resolve('unknown')
  if (checked?.site !== site) {
    checked = { site, result: checkSite(site, fetchFile).then((r) => (r.ok ? 'ok' : 'unreachable')) }
  }
  return checked.result
}

let guideDismissed = false

/** The person chose "Share anyway" on the guided screen: do not ask again until the app restarts. */
export function dismissSiteGuide(): void {
  guideDismissed = true
}

/**
 * Should the guided screen come before sharing? Only in the app, only while the site is the built-in
 * one (a site the person chose themselves is theirs to fix), and only when there is none or it does
 * not answer. Never throws.
 */
export async function needsSiteSetup(): Promise<boolean> {
  if (!isNativeApp() || guideDismissed || chosenSite()) return false
  if (!siteAddress()) return true
  try {
    return (await siteReach()) === 'unreachable'
  } catch {
    return false
  }
}

/** Forget the answer (after the person chose another site, or checked one by hand). */
export function forgetSiteReach(): void {
  checked = undefined
}

export function useSiteAddress(): string {
  return useSyncExternalStore(onSiteChange, siteAddress, siteAddress)
}

export function hostLabel(site: string): string {
  try {
    const u = new URL(site)
    return u.pathname === '/' ? u.host : `${u.host}${u.pathname.replace(/\/$/, '')}`
  } catch {
    return site
  }
}

export function useSiteReach(): Reach {
  const site = useSiteAddress()
  const [reach, setReach] = useState<Reach>('unknown')
  useEffect(() => {
    if (!isNativeApp()) return undefined
    let live = true
    void siteReach().then((r) => {
      if (live) setReach(r)
    })
    return () => {
      live = false
    }
  }, [site])
  return reach
}

