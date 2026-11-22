import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Button } from '../../ui/index.ts'
import { useNotify } from '../core/notify.ts'
import './UpdatePrompt.css'

/**
 * Service worker registration with a "prompt" update flow: a new version
 * waits until the person chooses to reload, so an open session (a form
 * being filled in, a giver mid-claim) is never interrupted.
 */
export default function UpdatePrompt() {
  const notify = useNotify()
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Check for a new version every hour while the app stays open.
      if (registration) window.setInterval(() => void registration.update().catch(() => undefined), 60 * 60 * 1000)
    },
  })

  useEffect(() => {
    if (!offlineReady) return
    notify('Hippo is ready to work offline.')
    setOfflineReady(false)
  }, [offlineReady, notify, setOfflineReady])

  if (!needRefresh) return null
  return (
    <div className="update-prompt frost frost--bar" role="region" aria-label="Update available">
      <p className="update-prompt__text">A new version of Hippo is ready.</p>
      <div className="update-prompt__actions">
        <Button variant="ghost" size="md" onClick={() => setNeedRefresh(false)}>
          Later
        </Button>
        <Button variant="primary" size="md" onClick={() => void updateServiceWorker(true)}>
          Reload
        </Button>
      </div>
    </div>
  )
}
