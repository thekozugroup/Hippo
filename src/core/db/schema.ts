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

/** When and on which device a synced field was last written: [ms on the corrected clock, device id]. */
export type Stamp = [number, string]

/**
 * This device's view of one record of the account (PROTOCOL.md section 12): the merged state of
 * every version it has seen or written, keyed by the record's slot on the sync servers.
 */
export interface AccountRecordRow {
  /** The event's `d` slot. */
  d: string
  type: string
  id: string
  /** Field values (absent: no value). Empty for a deleted record. */
  data: Record<string, unknown>
  /** One stamp per field that was ever written. */
  f: Record<string, Stamp>
  /** Set once the record is deleted; deletion is final. */
  del?: Stamp
  /** Highest `created_at` of a valid event seen or sent for this slot (unix seconds). */
  createdAt?: number
  /** Expiration of the newest event for this slot (unix seconds). */
  expiresAt?: number
  /** This device holds a version the sync servers do not have yet. */
  pending?: boolean
  /** A record from the account this device will not apply (a list it holds as a guest is owned, for example). */
  refused?: string
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
  declare accountRecords: Table<AccountRecordRow, string>

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
    // v3: your Hippo account (PROTOCOL.md section 12). A new table only: every existing row stays
    // as it is, and nothing is synced until the person turns the account on.
    this.version(3).stores({ accountRecords: 'd, type' })
  }
}

export function openDb(name: string = DB_NAME): HippoDb {
  return new HippoDb(name)
}
