import Dexie, { type Table } from 'dexie'
import type { NostrEvent } from 'nostr-tools/core'
import type { Category, GuestList, Item, RetiredList, SharedList } from '../model/types.ts'

/** Latest verified event per (topic, d-slot). */
export interface CachedEvent {
  topic: string
  d: string
  event: NostrEvent
  /** True for my own event that no relay has accepted yet; repair retries it. */
  pending?: boolean
  /**
   * True for my own claim whose slot no relay has ever accepted. Repair
   * re-stamps its `createdAt` before sending, so a claim drafted offline is
   * dated when it reaches the relays (PROTOCOL.md section 6).
   */
  unsent?: boolean
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
  declare retiredLists: Table<RetiredList, string>
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
    // v2: retired lists (rotation and deletion, FR-25). The wire format
    // changed with this version (derived item ids, new expiration), so cached
    // events from v1 are dropped; owners republish and givers refetch.
    this.version(2)
      .stores({ retiredLists: 'topic, ownerPubkey, listId' })
      .upgrade(async (tx) => {
        await tx.table('events').clear()
      })
  }
}

export function openDb(name: string = DB_NAME): HippoDb {
  return new HippoDb(name)
}
