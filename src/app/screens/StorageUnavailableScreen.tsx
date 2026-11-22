import { useEffect } from 'react'
import { RotateCw } from 'lucide-react'
import { Button } from '../../ui/index.ts'
import { AppScreen } from '../layout/AppScreen.tsx'
import { ScreenMessage } from '../layout/ScreenMessage.tsx'
import { pageTitle } from '../layout/titles.ts'

/** Shown when the on-device database cannot be opened, so nothing could be saved. */
export function StorageUnavailableScreen() {
  useEffect(() => {
    document.title = pageTitle('Cannot save on this device')
  }, [])
  return (
    <AppScreen title="Hippo cannot save on this device">
      <ScreenMessage
        actions={
          <Button variant="primary" icon={<RotateCw />} onClick={() => window.location.reload()}>
            Try again
          </Button>
        }
      >
        <p>Hippo keeps everything on your device, and this browser is not letting it save right now.</p>
      </ScreenMessage>
      <section className="app-stack app-stack--tight" aria-labelledby="storage-help">
        <h2 id="storage-help" className="app-section-title">
          Things to try
        </h2>
        <ul className="app-steps">
          <li>Leave private or incognito browsing and open Hippo in a normal window.</li>
          <li>Allow this site to store data (cookies and site data) in your browser settings.</li>
          <li>Close other Hippo tabs or windows, then try again.</li>
          <li>Free up some space on your device if it is nearly full.</li>
        </ul>
      </section>
    </AppScreen>
  )
}
