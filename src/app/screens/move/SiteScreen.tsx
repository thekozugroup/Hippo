// "Use my own Hippo site" (Android app only): the Hippo website the app's share and transfer links
// point at. Built in at first; the person can enter the address of their own copy (or of a site
// that moved). The address is checked through the app's native fetch of its hippo.json before it
// is used; a site that cannot be reached or is not Hippo is refused and the previous one kept.

import { useState } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import { Button, TextField } from '../../../ui/index.ts'
import { DEFAULT_RELAYS, getSettings, setRelayOverride } from '../../../core/index.ts'
import { useCore } from '../../core/context.ts'
import { useNotify } from '../../core/notify.ts'
import { useSettings } from '../../core/data.ts'
import { AppScreen } from '../../layout/AppScreen.tsx'
import { checkSite, relaysAfterSiteChange, siteProblemText } from '../../lib/site-check.ts'
import { chosenSite, PUBLIC_SITE_URL, setChosenSite } from '../../lib/site-address.ts'
import { SiteReachNote } from '../../lib/SiteReach.tsx'
import { forgetSiteReach, hostLabel, useSiteAddress } from '../../lib/site-reach.ts'
import { isNativeApp, siteFileFetcher } from '../../native/index.ts'
import './move.css'

export default function SiteScreen() {
  const core = useCore()
  const notify = useNotify()
  const settings = useSettings()
  const site = useSiteAddress()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [checking, setChecking] = useState(false)
  const inSetup = settings?.onboarding?.status === 'active'
  const custom = chosenSite() !== undefined

  const adoptRelays = async (siteRelays: readonly string[] | undefined) => {
    const before = chosenSite()?.adoptedRelays
    const current = (await getSettings(core.db)).relays
    const next = relaysAfterSiteChange(current, before, siteRelays ?? DEFAULT_RELAYS, DEFAULT_RELAYS)
    if (next === 'keep') return before
    await setRelayOverride(core.db, next.relays)
    return next.adopted
  }

  const use = async () => {
    if (checking) return
    const fetchFile = siteFileFetcher()
    if (!fetchFile) {
      setError('Only the Android app can change its Hippo site.')
      return
    }
    setChecking(true)
    setError(undefined)
    const r = await checkSite(text, fetchFile)
    if (!r.ok) {
      setError(siteProblemText(r.problem))
      setChecking(false)
      return
    }
    try {
      const adopted = await adoptRelays(r.info.relays)
      setChosenSite({ url: r.url, host: r.host, checkedAt: core.now(), ...(adopted ? { adoptedRelays: adopted } : {}) })
      forgetSiteReach()
      setText('')
      notify(`Connected to ${r.host}. New links open there.`)
    } catch {
      setError('Could not save the site. Please try again.')
    } finally {
      setChecking(false)
    }
  }

  const reset = async () => {
    try {
      await adoptRelays(undefined)
    } catch {
      // The relays stay as they were.
    }
    setChosenSite(undefined)
    forgetSiteReach()
    notify(`Back to ${hostLabel(PUBLIC_SITE_URL)}.`)
  }

  return (
    <AppScreen title="Your Hippo site" back={inSetup ? '#/existing' : '#/settings'} backLabel="Back">
      <section className="app-stack" aria-labelledby="site-now">
        <h2 id="site-now" className="app-section-title">
          Links open on
        </h2>
        <p className="move-summary app-note" data-testid="site-host">
          {hostLabel(site)}
        </p>
        <SiteReachNote what="links you share" />
        <p className="app-note">Lists you shared before keep the address they were made with.</p>
      </section>
      <form
        className="app-stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void use()
        }}
      >
        <h2 className="app-section-title">Use my own Hippo site</h2>
        <p className="app-note">If you run your own copy of the Hippo website, or yours moved to its own address, enter it here. Hippo checks it first.</p>
        <TextField
          label="Hippo website address"
          value={text}
          inputMode="url"
          autoComplete="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="gifts.example.org"
          onChange={(e) => setText(e.target.value)}
          {...(error ? { error } : {})}
        />
        <div className="app-row">
          <Button type="submit" variant="primary" icon={<Check />} loading={checking} disabled={!isNativeApp()}>
            Check and use
          </Button>
          {custom ? (
            <Button type="button" variant="ghost" icon={<RotateCcw />} onClick={() => void reset()}>
              Use the built-in site
            </Button>
          ) : null}
        </div>
      </form>
    </AppScreen>
  )
}
