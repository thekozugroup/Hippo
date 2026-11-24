// Connecting the app to a Hippo website: the check, then the relays and the saved address. Shared by
// "Use my own Hippo site" (Settings, "I already use Hippo") and the guided screen before a first share.

import { DEFAULT_RELAYS, getSettings, setRelayOverride, type Core } from '../../core/index.ts'
import { checkSite, relaysAfterSiteChange, siteProblemText, type FileFetcher } from './site-check.ts'
import { chosenSite, setChosenSite } from './site-address.ts'
import { forgetSiteReach } from './site-reach.ts'

type CoreForSite = Pick<Core, 'db' | 'now'>

/** Takes the site's relays as this device's, unless the person set their own. Returns what was adopted. */
export async function adoptSiteRelays(core: CoreForSite, siteRelays: readonly string[] | undefined): Promise<string[] | undefined> {
  const before = chosenSite()?.adoptedRelays
  const current = (await getSettings(core.db)).relays
  const next = relaysAfterSiteChange(current, before, siteRelays ?? DEFAULT_RELAYS, DEFAULT_RELAYS)
  if (next === 'keep') return before
  await setRelayOverride(core.db, next.relays)
  return next.adopted
}

export type ConnectResult = { ok: true; host: string; url: string } | { ok: false; error: string }

/**
 * Checks what the person typed and, if it is a Hippo website, makes it the site links open on.
 * Never throws; the error is one plain sentence for under the field. Nothing is saved on failure.
 */
export async function connectSite(core: CoreForSite, input: string, fetchFile: FileFetcher): Promise<ConnectResult> {
  const r = await checkSite(input, fetchFile)
  if (!r.ok) return { ok: false, error: siteProblemText(r.problem) }
  try {
    const adopted = await adoptSiteRelays(core, r.info.relays)
    setChosenSite({ url: r.url, host: r.host, checkedAt: core.now(), ...(adopted ? { adoptedRelays: adopted } : {}) })
    forgetSiteReach()
    return { ok: true, host: r.host, url: r.url }
  } catch {
    return { ok: false, error: 'Could not save the site. Please try again.' }
  }
}
