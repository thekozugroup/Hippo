// Export and import (PRD FR-6). The file contains every secret needed to
// keep managing shared lists and claims on a new device, so the UI must
// tell the user to store it privately.

import type { HippoDb } from '../db/schema.ts'
import { getSettings, sanitizeRelays, setLastExportAt, type Theme } from '../db/settings.ts'
import { HippoError } from '../errors.ts'
import { SchemaError, readArray, readObject, readTimestamp } from '../model/guards.ts'
import type { Category, GuestList, Item, SharedList } from '../model/types.ts'
import { parseCategory, parseGuestList, parseItem, parseSharedList } from '../model/validate.ts'

export const EXPORT_FORMAT = 'hippo-export'
export const EXPORT_VERSION = 1

export interface ExportFile {
  format: typeof EXPORT_FORMAT
  version: typeof EXPORT_VERSION
  exportedAt: number
  items: Item[]
  categories: Category[]
  sharedLists: SharedList[]
  guestLists: GuestList[]
  settings: { theme?: Theme; relays?: string[] }
}

export async function exportData(db: HippoDb, now = Date.now()): Promise<ExportFile> {
  const [items, categories, sharedLists, guestLists, settings] = await Promise.all([
    db.items.toArray(),
    db.categories.toArray(),
    db.sharedLists.toArray(),
    db.guestLists.toArray(),
    getSettings(db),
  ])
  const file: ExportFile = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now,
    items,
    categories,
    sharedLists,
    guestLists,
    settings: { theme: settings.theme },
  }
  if (settings.relays) file.settings.relays = settings.relays
  await setLastExportAt(db, now)
  return file
}

const MAX_RECORDS = 10_000

function parseRecords<T>(value: unknown, path: string, parse: (v: unknown, path: string) => T): T[] {
  return readArray(value, path, MAX_RECORDS).map((v, i) => parse(v, `${path}[${i}]`))
}

/**
 * Validates an untrusted export file (already JSON-parsed). Throws
 * `unsupported-version` for other formats or versions and `invalid-import`
 * (with the failing path) for anything malformed. Nothing is dropped
 * silently: one bad record rejects the whole file.
 */
export function parseExportFile(value: unknown): ExportFile {
  try {
    const o = readObject(value, 'file')
    if (o.format !== EXPORT_FORMAT) throw new HippoError('unsupported-version', 'not a Hippo export file')
    if (o.version !== EXPORT_VERSION) {
      throw new HippoError('unsupported-version', `export version ${String(o.version)} is not supported`)
    }
    const settingsIn = o.settings === undefined ? {} : readObject(o.settings, 'settings')
    const settings: ExportFile['settings'] = {}
    if (settingsIn.theme === 'system' || settingsIn.theme === 'light' || settingsIn.theme === 'dark') settings.theme = settingsIn.theme
    if (settingsIn.relays !== undefined) {
      const relays = sanitizeRelays(settingsIn.relays)
      if (!relays || relays.length !== (settingsIn.relays as unknown[]).length) {
        throw new SchemaError('settings.relays', 'invalid relay list')
      }
      settings.relays = relays
    }
    const file: ExportFile = {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: readTimestamp(o.exportedAt, 'exportedAt'),
      items: parseRecords(o.items, 'items', parseItem),
      categories: parseRecords(o.categories, 'categories', parseCategory),
      sharedLists: parseRecords(o.sharedLists, 'sharedLists', parseSharedList),
      guestLists: parseRecords(o.guestLists, 'guestLists', parseGuestList),
      settings,
    }
    for (const [name, ids] of [
      ['items', file.items.map((r) => r.id)],
      ['categories', file.categories.map((r) => r.id)],
      ['sharedLists', file.sharedLists.map((r) => r.id)],
      ['guestLists', file.guestLists.map((r) => r.topic)],
    ] as const) {
      if (new Set(ids).size !== ids.length) throw new SchemaError(name, 'duplicate ids')
    }
    return file
  } catch (e) {
    if (e instanceof SchemaError) throw new HippoError('invalid-import', e.message)
    throw e
  }
}

export interface ImportResult {
  items: number
  categories: number
  sharedLists: number
  guestLists: number
}

/**
 * Imports an export file. `replace` clears local data first; `merge`
 * (default) upserts by id, so records in the file win over local ones.
 * Cached relay events are not part of the file; they are refetched.
 */
export async function importData(
  db: HippoDb,
  value: unknown,
  options: { mode?: 'merge' | 'replace' } = {},
): Promise<ImportResult> {
  const file = parseExportFile(value)
  await db.transaction('rw', [db.items, db.categories, db.sharedLists, db.guestLists, db.settings, db.events], async () => {
    if (options.mode === 'replace') {
      await Promise.all([db.items.clear(), db.categories.clear(), db.sharedLists.clear(), db.guestLists.clear(), db.events.clear()])
    }
    await db.items.bulkPut(file.items)
    await db.categories.bulkPut(file.categories)
    await db.sharedLists.bulkPut(file.sharedLists)
    await db.guestLists.bulkPut(file.guestLists)
    if (file.settings.theme) await db.settings.put({ key: 'theme', value: file.settings.theme })
    if (file.settings.relays) await db.settings.put({ key: 'relays', value: file.settings.relays })
  })
  return {
    items: file.items.length,
    categories: file.categories.length,
    sharedLists: file.sharedLists.length,
    guestLists: file.guestLists.length,
  }
}
