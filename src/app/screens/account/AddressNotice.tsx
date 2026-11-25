// Home: "This Hippo site now lives at <host>". Shown only on the website, only when this page is not
// at the address the site was built for, and only to someone with their own wishes or lists here
// (never to someone who only opened a shared list). One tap turns the account on if needed, makes
// a device link for the new address and goes there, where the person signs in with their data.
// Nothing happens without that tap.

import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button } from '../../../ui/index.ts'
import { useCore } from '../../core/context.ts'
import { useNotify } from '../../core/notify.ts'
import { transferStartError } from '../move/move-text.ts'
import { dismissSiteNotice } from './address.ts'
import { makeDeviceLink } from './device-link.ts'
import './account.css'

export default function AddressNotice({ site, onDismiss }: { site: string; onDismiss: () => void }) {
  const core = useCore()
  const notify = useNotify()
  const [busy, setBusy] = useState(false)
  const host = new URL(site).host

  const go = async () => {
    if (busy) return
    setBusy(true)
    try {
      const t = await makeDeviceLink(core, site)
      const target = new URL(t.url)
      // Test mode only (loopback relays): the new address must use the same local test server.
      if (core.forcedRelays) target.searchParams.set('relays', core.forcedRelays.join(','))
      window.location.assign(target.href)
    } catch (e) {
      notify(transferStartError(e))
      setBusy(false)
    }
  }

  return (
    <section className="site-notice" aria-labelledby="site-moved" data-testid="site-notice">
      <h2 id="site-moved" className="site-notice__text">{`This Hippo site now lives at ${host}`}</h2>
      <p className="app-note">Your wishes are saved at this address. Bring them to the new one and sign in there in one step.</p>
      <div className="app-row">
        <Button variant="primary" size="md" icon={<ArrowRight />} loading={busy} onClick={() => void go()}>
          {`Go to ${host}`}
        </Button>
        <Button
          variant="ghost"
          size="md"
          disabled={busy}
          onClick={() => {
            dismissSiteNotice()
            onDismiss()
          }}
        >
          Not now
        </Button>
      </div>
    </section>
  )
}
