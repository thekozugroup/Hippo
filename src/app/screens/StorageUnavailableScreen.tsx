import { useEffect } from 'react'
import { HardDrive, RotateCw } from 'lucide-react'
import { Button, EmptyState, TwoTone } from '../../ui/index.ts'
import { AppScreen } from '../layout/AppScreen.tsx'
import { pageTitle } from '../layout/titles.ts'

/** Shown when the on-device database cannot be opened, so nothing could be saved. */
export function StorageUnavailableScreen() {
  useEffect(() => {
    document.title = pageTitle('Cannot save on this device')
  }, [])
  return (
    <AppScreen title="Hippo cannot save on this device">
      <EmptyState
        icon={<HardDrive />}
        title={<TwoTone muted="Storage is blocked." bright="Hippo needs it to keep your wishes." />}
        description="Hippo keeps everything on your device, but this browser is not letting it save anything right now."
        action={
          <Button variant="primary" icon={<RotateCw />} onClick={() => window.location.reload()}>
            Try again
          </Button>
        }
      />
      <section className="app-stack" aria-labelledby="storage-help">
        <h2 id="storage-help" className="app-section-title">
          Things to try
        </h2>
        <ul className="app-steps app-steps--bullets">
          <li>
            <span>Leave private or incognito browsing and open Hippo in a normal window.</span>
          </li>
          <li>
            <span>Allow this site to store data (cookies and site data) in your browser settings.</span>
          </li>
          <li>
            <span>Close other Hippo tabs or windows, then try again.</span>
          </li>
          <li>
            <span>Free up some space on your device if it is nearly full.</span>
          </li>
        </ul>
      </section>
    </AppScreen>
  )
}
