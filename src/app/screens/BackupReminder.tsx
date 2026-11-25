import { Download, X } from 'lucide-react'
import { IconButton } from '../../ui/index.ts'
import { useBackupReminder } from '../core/storage.ts'

/**
 * Shown on Home when the browser would not promise to keep Hippo's data. `quiet`: a plain line, when
 * another notice already leads the screen.
 */
export function BackupReminder({ lastExportAt, quiet = false }: { lastExportAt: number | undefined; quiet?: boolean }) {
  const { show, dismiss } = useBackupReminder(lastExportAt)
  if (!show) return null
  return (
    <div className={quiet ? 'app-banner app-banner--quiet' : 'app-banner'} role="note" aria-labelledby="backup-reminder-title">
      <Download aria-hidden="true" />
      <div className="app-banner__body">
        <p id="backup-reminder-title" className="app-banner__title">
          Keep a backup
        </p>
        <p>
          This browser may clear Hippo&apos;s data to free up space.{' '}
          <a className="app-text-link" href="#/settings">
            Save a backup in Settings
          </a>{' '}
          now and then.
        </p>
      </div>
      <IconButton aria-label="Dismiss backup reminder" icon={<X />} variant="ghost" onClick={dismiss} />
    </div>
  )
}
