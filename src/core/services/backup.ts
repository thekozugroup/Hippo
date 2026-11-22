// Export and import (PRD FR-6). The file contains every secret needed to
// keep managing shared lists and claims on a new device, so the UI must
// tell the user to store it privately.

import { systemNow } from '../clock.ts'
import { publicKeyOf, topicForSecret } from '../crypto/keys.ts'
import type { HippoDb } from '../db/schema.ts'
import { cleanOwnerName, getSettings, sanitizeRelays, setLastExportAt, type Theme } from '../db/settings.ts'
import { codePointLength } from '../model/guards.ts'
import { LIMITS } from '../model/limits.ts'
import { LINK_PREVIEW_SETTING_KEY } from './link-preview.ts'
import { HippoError } from '../errors.ts'
import { SchemaError, readArray, readObject, readTimestamp } from '../model/guards.ts'
import type { Category, GuestList, Item, RetiredList, SharedList } from '../model/types.ts'
import { parseCategory, parseGuestList, parseItem, parseRetiredList, parseSharedList } from '../model/validate.ts'

export const EXPORT_FORMAT = 'hippo-export'
/** Version 2 added the owner's name, the link lookup setting and whether setup is done. Version 1 files still import. */
export const EXPORT_VERSION = 2
const READABLE_VERSIONS: readonly number[] = [1, 2]

export interface ExportSettings {
  theme?: Theme
  relays?: string[]
  /** The owner's display name: givers see "Ann's list" (max 40 characters). */
  ownerName?: string
  /** The opt-in link lookup (Settings, "Link lookup"); only `true` means on. */
  linkPreview?: boolean
  /** First-run setup was finished or closed on the exporting device, so a restore does not start it again. */
  setup?: 'completed' | 'dismissed'
}

export interface ExportFile {
  format: typeof EXPORT_FORMAT
  version: typeof EXPORT_VERSION
  exportedAt: number
  items: Item[]
  categories: Category[]
  sharedLists: SharedList[]
  guestLists: GuestList[]
  /** Rotated and deleted lists: needed to keep FR-25 and to finish cutting off old links. */
  retiredLists: RetiredList[]
  settings: ExportSettings
}

export async function exportData(db: HippoDb, now = systemNow()): Promise<ExportFile> {
  const [items, categories, sharedLists, guestLists, retiredLists, settings, linkPreview] = await Promise.all([
    db.items.toArray(),
    db.categories.toArray(),
    db.sharedLists.toArray(),
    db.guestLists.toArray(),
    db.retiredLists.toArray(),
    getSettings(db),
    db.settings.get(LINK_PREVIEW_SETTING_KEY),
  ])
  const file: ExportFile = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now,
    items,
    categories,
    sharedLists,
    guestLists,
    retiredLists,
    settings: { theme: settings.theme },
  }
  if (settings.relays) file.settings.relays = settings.relays
  if (settings.ownerName) file.settings.ownerName = settings.ownerName
  if (linkPreview?.value === true) file.settings.linkPreview = true
  const status = settings.onboarding?.status
  if (status === 'completed' || status === 'dismissed') file.settings.setup = status
  await setLastExportAt(db, now)
  return file
}

const MAX_RECORDS = 10_000

function parseRecords<T>(value: unknown, path: string, parse: (v: unknown, path: string) => T): T[] {
  return readArray(value, path, MAX_RECORDS).map((v, i) => parse(v, `${path}[${i}]`))
}

interface OwnedIdentity {
  topics: Set<string>
  pubkeys: Set<string>
}

function ownedBy(sharedLists: readonly SharedList[], retired: readonly RetiredList[]): OwnedIdentity {
  const o: OwnedIdentity = { topics: new Set(), pubkeys: new Set() }
  for (const l of sharedLists) {
    o.topics.add(topicForSecret(l.listSecret))
    o.pubkeys.add(publicKeyOf(l.ownerSecretKey))
  }
  for (const r of retired) {
    o.topics.add(r.topic)
    o.pubkeys.add(r.ownerPubkey)
  }
  return o
}

/** FR-25: a guest list must not be one of the owned or retired lists. */
function checkNoOwnGuestList(guests: readonly GuestList[], owned: OwnedIdentity, path: string): void {
  guests.forEach((g, i) => {
    if (owned.topics.has(g.topic) || owned.pubkeys.has(g.ownerPubkey)) {
      throw new SchemaError(`${path}[${i}]`, 'is a list this device or backup owns')
    }
  })
}

/**
 * Validates an untrusted export file (already JSON-parsed). Throws
 * `unsupported-version` for other formats or versions and `invalid-import`
 * (with the failing path) for anything malformed: invalid keys, a guest
 * topic that does not match its secret, or a guest list that is one of the
 * file's own lists (FR-25). Nothing is dropped silently: one bad record
 * rejects the whole file.
 */
export function parseExportFile(value: unknown): ExportFile {
  try {
    const o = readObject(value, 'file')
    if (o.format !== EXPORT_FORMAT) throw new HippoError('unsupported-version', 'not a Hippo export file')
    if (typeof o.version !== 'number' || !READABLE_VERSIONS.includes(o.version)) {
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
    if (settingsIn.ownerName !== undefined) {
      const name = cleanOwnerName(settingsIn.ownerName)
      if (!name || codePointLength(name) > LIMITS.ownerName) throw new SchemaError('settings.ownerName', `expected a name of 1 to ${LIMITS.ownerName} characters`)
      settings.ownerName = name
    }
    if (settingsIn.linkPreview !== undefined) {
      if (typeof settingsIn.linkPreview !== 'boolean') throw new SchemaError('settings.linkPreview', 'expected true or false')
      if (settingsIn.linkPreview) settings.linkPreview = true
    }
    if (settingsIn.setup !== undefined) {
      if (settingsIn.setup !== 'completed' && settingsIn.setup !== 'dismissed') throw new SchemaError('settings.setup', 'expected completed or dismissed')
      settings.setup = settingsIn.setup
    }
    const file: ExportFile = {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: readTimestamp(o.exportedAt, 'exportedAt'),
      items: parseRecords(o.items, 'items', parseItem),
      categories: parseRecords(o.categories, 'categories', parseCategory),
      sharedLists: parseRecords(o.sharedLists, 'sharedLists', parseSharedList),
      guestLists: parseRecords(o.guestLists, 'guestLists', parseGuestList),
      retiredLists: o.retiredLists === undefined ? [] : parseRecords(o.retiredLists, 'retiredLists', parseRetiredList),
      settings,
    }
    for (const [name, ids] of [
      ['items', file.items.map((r) => r.id)],
      ['categories', file.categories.map((r) => r.id)],
      ['sharedLists', file.sharedLists.map((r) => r.id)],
      ['sharedLists', file.sharedLists.map((r) => r.listSecret)],
      ['guestLists', file.guestLists.map((r) => r.topic)],
      ['retiredLists', file.retiredLists.map((r) => r.topic)],
    ] as const) {
      if (new Set(ids).size !== ids.length) throw new SchemaError(name, 'duplicate ids')
    }
    checkNoOwnGuestList(file.guestLists, ownedBy(file.sharedLists, file.retiredLists), 'guestLists')
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
  /** Lists in the file that were already on this device and were kept as they are (merge). */
  skippedLists: number
}

/**
 * Imports an export file.
 *
 * `merge` (default) upserts items and categories by id (the file wins), but
 * never replaces a list already on this device: shared lists (by id), guest
 * lists (by topic) and retired lists (by topic) that exist locally are kept
 * as they are, so a file cannot swap their keys, owner key or relays.
 *
 * `replace` clears local data first. Lists this device owned that are not
 * in the file are remembered as deleted (topic and owner key only), so the
 * device still never opens them as a guest (FR-25).
 *
 * Either way, the import is refused (`invalid-import`) when a guest list
 * would be one of the lists this device owns or retired, or a shared list
 * one this device holds as a guest. Cached relay events are not part of
 * the file; they are refetched.
 */
export async function importData(
  db: HippoDb,
  value: unknown,
  options: { mode?: 'merge' | 'replace'; now?: number } = {},
): Promise<ImportResult> {
  const file = parseExportFile(value)
  const now = options.now ?? systemNow()
  let skipped = 0
  await db.transaction(
    'rw',
    [db.items, db.categories, db.sharedLists, db.guestLists, db.retiredLists, db.settings, db.events],
    async () => {
      const [localShared, localGuests, localRetired] = await Promise.all([
        db.sharedLists.toArray(),
        db.guestLists.toArray(),
        db.retiredLists.toArray(),
      ])
      let sharedIn = file.sharedLists
      let guestsIn = file.guestLists
      let retiredIn = file.retiredLists
      const keptRetired: RetiredList[] = [...localRetired]

      if (options.mode === 'replace') {
        // Remember owned lists that the file drops, so FR-25 still holds for them.
        const fileSecrets = new Set(file.sharedLists.map((l) => l.listSecret))
        for (const l of localShared) {
          if (fileSecrets.has(l.listSecret)) continue
          const topic = topicForSecret(l.listSecret)
          if (keptRetired.some((r) => r.topic === topic)) continue
          keptRetired.push({ topic, ownerPubkey: publicKeyOf(l.ownerSecretKey), listId: l.id, reason: 'deleted', retiredAt: now })
        }
        await Promise.all([db.items.clear(), db.categories.clear(), db.sharedLists.clear(), db.guestLists.clear(), db.events.clear()])
        const localRetiredTopics = new Set(keptRetired.map((r) => r.topic))
        retiredIn = retiredIn.filter((r) => !localRetiredTopics.has(r.topic))
        await db.retiredLists.bulkPut(keptRetired)
      } else {
        const sharedIds = new Set(localShared.map((l) => l.id))
        const sharedSecrets = new Set(localShared.map((l) => l.listSecret))
        const guestTopics = new Set(localGuests.map((g) => g.topic))
        const retiredTopics = new Set(localRetired.map((r) => r.topic))
        const before = sharedIn.length + guestsIn.length
        sharedIn = sharedIn.filter((l) => !sharedIds.has(l.id) && !sharedSecrets.has(l.listSecret))
        guestsIn = guestsIn.filter((g) => !guestTopics.has(g.topic))
        retiredIn = retiredIn.filter((r) => !retiredTopics.has(r.topic))
        skipped = before - sharedIn.length - guestsIn.length
      }

      // FR-25 across the device and the file.
      const finalShared = options.mode === 'replace' ? sharedIn : [...localShared, ...sharedIn]
      const finalGuests = options.mode === 'replace' ? guestsIn : [...localGuests, ...guestsIn]
      const owned = ownedBy(finalShared, [...keptRetired, ...retiredIn])
      try {
        checkNoOwnGuestList(finalGuests, owned, 'guestLists')
      } catch (e) {
        if (e instanceof SchemaError) {
          throw new HippoError('invalid-import', `${e.message}: a list you own cannot also be a list shared with you`)
        }
        throw e
      }

      await db.items.bulkPut(file.items)
      await db.categories.bulkPut(file.categories)
      await db.sharedLists.bulkPut(sharedIn)
      await db.guestLists.bulkPut(guestsIn)
      await db.retiredLists.bulkPut(retiredIn)
      if (file.settings.theme) await db.settings.put({ key: 'theme', value: file.settings.theme })
      if (file.settings.relays) await db.settings.put({ key: 'relays', value: file.settings.relays })
      if (file.settings.ownerName) await db.settings.put({ key: 'ownerName', value: file.settings.ownerName })
      if (file.settings.linkPreview) await db.settings.put({ key: LINK_PREVIEW_SETTING_KEY, value: true })
      // A restore is not a first run: unless setup already ended on this device, mark it done, so
      // the person lands on Home with their data instead of in first-run setup.
      const onboarding = (await getSettings(db)).onboarding
      const restoresSomething = file.items.length + file.sharedLists.length + file.guestLists.length > 0 || file.settings.setup !== undefined
      if (restoresSomething && (!onboarding || onboarding.status === 'active')) {
        await db.settings.put({ key: 'onboarding', value: { status: file.settings.setup ?? 'completed', step: 0, answers: {}, updatedAt: now } })
      }
    },
  )
  return {
    items: file.items.length,
    categories: file.categories.length,
    sharedLists: file.sharedLists.length,
    guestLists: file.guestLists.length,
    skippedLists: skipped,
  }
}
