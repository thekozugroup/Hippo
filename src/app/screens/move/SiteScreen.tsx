// "Use my own Hippo site" (Android app only): the Hippo website the app's share and transfer links
// point at. Built in at first; the person can enter the address of their own copy (or of a site
// that moved). The address is checked through the app's native fetch of its hippo.json before it
// is used; a site that cannot be reached or is not Hippo is refused and the previous one kept.

import { RotateCcw } from 'lucide-react'
import { Button } from '../../../ui/index.ts'
import { useNotify } from '../../core/notify.ts'
import { useSettings } from '../../core/data.ts'
import { useCore } from '../../core/context.ts'
import { AppScreen } from '../../layout/AppScreen.tsx'
import { adoptSiteRelays } from '../../lib/connect-site.ts'
import { chosenSite, PUBLIC_SITE_URL, setChosenSite } from '../../lib/site-address.ts'
import { SiteReachNote } from '../../lib/SiteReach.tsx'
import { forgetSiteReach, hostLabel, useSiteAddress } from '../../lib/site-reach.ts'
import { SiteSetup } from './SiteSetup.tsx'
import './move.css'

export default function SiteScreen() {
  const core = useCore()
  const notify = useNotify()
  const settings = useSettings()
  const site = useSiteAddress()
  const inSetup = settings?.onboarding?.status === 'active'
  const custom = chosenSite() !== undefined

  const reset = async () => {
    try {
      await adoptSiteRelays(core, undefined)
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
      <section className="app-stack" aria-labelledby="site-use">
        <h2 id="site-use" className="app-section-title">
          Use my own Hippo site
        </h2>
        <SiteSetup
          intro="The people you share with open your list in a browser. If you run your own copy of Hippo, or yours moved to its own address, enter it here. Hippo checks it first."
          onConnected={({ host }) => notify(`Connected to ${host}. New links open there.`)}
        />
        {custom ? (
          <div className="app-row">
            <Button type="button" variant="ghost" icon={<RotateCcw />} onClick={() => void reset()}>
              Use the built-in site
            </Button>
          </div>
        ) : null}
      </section>
    </AppScreen>
  )
}
