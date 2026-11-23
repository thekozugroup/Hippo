// Saves a backup file (all data, including list keys). On the website it is
// downloaded through a link. Inside the Android app a WebView cannot download
// a blob, so the file goes to the system share sheet instead (src/app/native/).

import { exportData, type HippoDb } from '../../core/index.ts'
import { shareBackupFile } from '../native/index.ts'

/** `saved`: downloaded (website). `shared`: handed to another app (Android app). `cancelled`: the share sheet was closed. */
export type BackupOutcome = 'saved' | 'shared' | 'cancelled'

export function backupFileName(date: Date = new Date()): string {
  return `hippo-backup-${date.toISOString().slice(0, 10)}.json`
}

export async function downloadBackup(db: HippoDb, now?: number): Promise<BackupOutcome> {
  const data = await exportData(db, now)
  const json = JSON.stringify(data, null, 2)
  const shared = await shareBackupFile(backupFileName(), json)
  if (shared === 'failed') throw new Error('The backup could not be shared.')
  if (shared !== undefined) return shared
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = backupFileName()
  document.body.append(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'saved'
}
