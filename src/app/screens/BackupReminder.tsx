import { Download, X } from 'lucide-react'
import { IconButton } from '../../ui/index.ts'
import { useBackupReminder } from '../core/storage.ts'

/** Shown when the browser would not promise to keep Hippo's data. */
export function BackupReminder({ lastExportAt, onSettings }: { lastExportAt: number | undefined; onSettings?: boolean }) {
  const { show, dismiss } = useBackupReminder(lastExportAt)
  if (!show) return null
  return (
    <div className="app-banner home-reminder" role="note" aria-labelledby="backup-reminder-title">
      <Download aria-hidden="true" />
      <div className="app-banner__body">
        <p id="backup-reminder-title" className="app-banner__title">
          Keep a backup
        </p>
        <p>
          This browser may clear Hippo&apos;s data to free up space. Save a backup file now and then so you do not lose your wishes and lists
          {onSettings ? (
            ' (Export, below).'
          ) : (
            <>
              {' '}
              (<a className="app-text-link" href="#/settings">
                Backup in Settings
              </a>
              ).
            </>
          )}
        </p>
      </div>
      <IconButton aria-label="Dismiss backup reminder" icon={<X />} variant="ghost" onClick={dismiss} />
    </div>
  )
}
