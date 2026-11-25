// Home's check for "This Hippo site now lives at <host>": a few bytes, run on every Home render.

import { useState } from 'react'
import { isNativeApp } from '../../native/platform.ts'
import { builtSiteAddress, movedSiteFor, siteNoticeDismissed } from './address.ts'

export interface SiteMoved {
  /** The site's new address. */
  site: string
  /** Hides the notice for this visit (after "Not now", which also remembers it). */
  hide: () => void
}

/**
 * The site's new address when the notice applies, else null. `ownData`: this browser holds the
 * person's own wishes or lists here (not only lists shared with them).
 */
export function useSiteMoved(ownData: boolean): SiteMoved | null {
  const [hidden, setHidden] = useState(() => siteNoticeDismissed())
  if (!ownData || hidden || isNativeApp()) return null
  const site = movedSiteFor(window.location.origin, builtSiteAddress())
  return site ? { site, hide: () => setHidden(true) } : null
}

