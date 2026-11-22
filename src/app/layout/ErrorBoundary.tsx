import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import { Download, RotateCw } from 'lucide-react'
import { Button } from '../../ui/index.ts'
import { useCore } from '../core/context.ts'
import { isStorageError } from '../core/storage.ts'
import { downloadBackup } from '../lib/backup-file.ts'
import { StorageUnavailableScreen } from '../screens/StorageUnavailableScreen.tsx'
import { AppScreen } from './AppScreen.tsx'
import { ScreenMessage } from './ScreenMessage.tsx'
import { pageTitle } from './titles.ts'

/** Shown when a screen fails to render: reload, or save a backup first. */
export function RecoveryScreen({ onRetry }: { onRetry?: () => void }) {
  const core = useCore()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  useEffect(() => {
    document.title = pageTitle('Something went wrong')
  }, [])

  const save = async () => {
    if (busy) return
    setBusy(true)
    setStatus(null)
    try {
      await downloadBackup(core.db)
      setStatus('Backup saved. Keep the file somewhere private.')
    } catch {
      setStatus('The backup could not be saved. Reloading may help.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppScreen title="Something went wrong">
      <ScreenMessage
        actions={
          <>
            <Button variant="primary" icon={<RotateCw />} onClick={() => window.location.reload()}>
              Reload Hippo
            </Button>
            <Button variant="secondary" icon={<Download />} loading={busy} onClick={() => void save()}>
              Save a backup
            </Button>
            {onRetry ? (
              <Button variant="ghost" onClick={onRetry}>
                Try again
              </Button>
            ) : null}
          </>
        }
      >
        <p>Your wishes and lists are still saved on this device. Reload Hippo to carry on. If it keeps happening, save a backup first.</p>
      </ScreenMessage>
      <p className="app-note" role="status">
        {status ?? ''}
      </p>
    </AppScreen>
  )
}

interface State {
  error: unknown
}

/** Top-level error boundary: a render error shows a recovery screen instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.warn('Hippo screen error', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children
    if (isStorageError(error)) return <StorageUnavailableScreen />
    return <RecoveryScreen onRetry={() => this.setState({ error: null })} />
  }
}
