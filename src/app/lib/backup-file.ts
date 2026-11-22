// Saves a backup file (all data, including list keys) through a download link.

import { exportData, type HippoDb } from '../../core/index.ts'

export async function downloadBackup(db: HippoDb): Promise<void> {
  const data = await exportData(db)
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `hippo-backup-${new Date().toISOString().slice(0, 10)}.json`
  document.body.append(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
