// Storage health: detect a database that cannot be opened (private
// browsing, blocked site data), ask the browser to keep Hippo's data
// (navigator.storage.persist), and remind people to export a backup when it
// will not.

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { HippoDb } from '../../core/index.ts'

/** Dexie and IndexedDB errors that mean the database cannot be used on this device. */
const STORAGE_ERRORS = new Set([
  'MissingAPIError',
  'OpenFailedError',
  'DatabaseClosedError',
  'InvalidStateError',
  'QuotaExceededError',
  'UnknownError',
  'VersionError',
  'SecurityError',
])

export function isStorageError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const inner = (e as Error & { inner?: unknown }).inner
  return STORAGE_ERRORS.has(e.name) || (inner instanceof Error && STORAGE_ERRORS.has(inner.name))
}

/**
 * Opens the database and reads from it. Resolves false when that fails or
 * does not finish within `timeoutMs` (for example when another tab blocks an
 * upgrade, or the browser refuses storage).
 */
export async function checkStorage(db: HippoDb, timeoutMs = 10_000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })
  const probe = (async () => {
    try {
      if (typeof indexedDB === 'undefined') return false
      await db.open()
      await db.settings.get('theme')
      return true
    } catch {
      return false
    }
  })()
  try {
    return await Promise.race([probe, timeout])
  } finally {
    clearTimeout(timer)
  }
}

const PERSIST_KEY = 'hippo:persist'
const DISMISS_KEY = 'hippo:backup-reminder-dismissed'
const CHANGE_EVENT = 'hippo:storage-reminder'

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage unavailable: the reminder just shows again next time.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

/**
 * Asks the browser to keep Hippo's data instead of clearing it under
 * storage pressure. Call after the first wish is saved or the first list is
 * published. Feature-detected and never blocks: callers do not await it.
 * Records the outcome so a backup reminder can be shown if it was refused.
 */
export async function requestPersistentStorage(storage: StorageManager | undefined = navigator.storage): Promise<boolean | undefined> {
  if (!storage || typeof storage.persist !== 'function') return undefined
  try {
    if (typeof storage.persisted === 'function' && (await storage.persisted())) {
      if (readLocal(PERSIST_KEY) !== 'granted') writeLocal(PERSIST_KEY, 'granted')
      return true
    }
    const granted = await storage.persist()
    writeLocal(PERSIST_KEY, granted ? 'granted' : 'denied')
    return granted
  } catch {
    return undefined
  }
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

function snapshot(): string {
  return `${readLocal(PERSIST_KEY) ?? ''}|${readLocal(DISMISS_KEY) ?? ''}`
}

/**
 * A gentle reminder to export a backup, shown when the browser did not agree
 * to keep Hippo's data, until the person dismisses it or makes a backup.
 */
export function useBackupReminder(lastExportAt: number | undefined): { show: boolean; dismiss: () => void } {
  const state = useSyncExternalStore(subscribe, snapshot, () => '|')
  const [persistedNow, setPersistedNow] = useState(false)
  useEffect(() => {
    let cancelled = false
    void navigator.storage
      ?.persisted?.()
      .then((p) => {
        if (!cancelled && p) setPersistedNow(true)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])
  const [persist, dismissed] = state.split('|')
  return {
    show: persist === 'denied' && !dismissed && !persistedNow && lastExportAt === undefined,
    dismiss: () => writeLocal(DISMISS_KEY, String(Date.now())),
  }
}
