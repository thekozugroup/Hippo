import Dexie, { type Table } from 'dexie'
import type { NostrEvent } from 'nostr-tools/core'
import type { Category, GuestList, Item, SharedList } from '../model/types.ts'

/** Latest verified event per (topic, d-slot). */
export interface CachedEvent {
  topic: string
  d: string
  event: NostrEvent
  /** True for my own event that no relay has accepted yet; repair retries it. */
  pending?: boolean
}

export interface SettingRow {
  key: string
  value: unknown
}

export const DB_NAME = 'hippo'

export class HippoDb extends Dexie {
  declare items: Table<Item, string>
  declare categories: Table<Category, string>
  declare sharedLists: Table<SharedList, string>
  declare guestLists: Table<GuestList, string>
  declare events: Table<CachedEvent, [string, string]>
  declare settings: Table<SettingRow, string>

  constructor(name: string = DB_NAME) {
    super(name)
    // Bump the version and add a new `.stores()` (plus `.upgrade()` if data
    // moves) for every schema change; never edit a shipped version.
    this.version(1).stores({
      items: 'id, updatedAt, archivedAt, *categoryIds',
      categories: 'id, order',
      sharedLists: 'id, status',
      guestLists: 'topic, lastOpenedAt',
      events: '[topic+d], topic',
      settings: 'key',
    })
  }
}

export function openDb(name: string = DB_NAME): HippoDb {
  return new HippoDb(name)
}
