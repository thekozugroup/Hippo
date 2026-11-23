// The system share sheet in the app (Capacitor Share), for share links and
// for backup files. A WebView cannot download a blob, so a backup is written
// to the app's private cache (Capacitor Filesystem) and shared from there; the
// app's FileProvider exposes only that folder (res/xml/file_paths.xml).

import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import type { ShareOutcome } from './index.ts'

/** Cache folder for backup files; emptied before each new backup and when the app starts. */
export const BACKUP_DIR = 'backups'

function cancelled(e: unknown): boolean {
  return e instanceof Error ? /cancel/i.test(e.message) : typeof e === 'string' && /cancel/i.test(e)
}

export async function shareLink(data: { title: string; text?: string; url: string }): Promise<ShareOutcome> {
  try {
    await Share.share({ title: data.title, ...(data.text ? { text: data.text } : {}), url: data.url, dialogTitle: 'Share link' })
    return 'shared'
  } catch (e) {
    return cancelled(e) ? 'cancelled' : 'failed'
  }
}

/** Removes backup files left from earlier shares. They hold list keys, so they do not stay longer than needed. */
export async function clearBackupFiles(): Promise<void> {
  try {
    await Filesystem.rmdir({ path: BACKUP_DIR, directory: Directory.Cache, recursive: true })
  } catch {
    // Nothing there.
  }
}

/** File names come from the app ("hippo-backup-2026-11-23.json"); anything else is refused. */
export function isBackupFileName(name: string): boolean {
  return /^hippo-backup-[0-9-]{1,20}\.json$/.test(name)
}

export async function shareBackup(fileName: string, json: string): Promise<ShareOutcome> {
  if (!isBackupFileName(fileName)) return 'failed'
  await clearBackupFiles()
  let uri: string
  try {
    uri = (await Filesystem.writeFile({ path: `${BACKUP_DIR}/${fileName}`, data: json, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true })).uri
  } catch {
    return 'failed'
  }
  try {
    await Share.share({ title: fileName, files: [uri], dialogTitle: 'Save backup' })
    return 'shared'
  } catch (e) {
    return cancelled(e) ? 'cancelled' : 'failed'
  }
}
