import type { NostrEvent } from 'nostr-tools/core'
import type { CachedEvent, HippoDb } from './schema.ts'

export interface CacheFlags {
  /** My event that no relay has accepted yet. */
  pending?: boolean
  /** My claim whose slot no relay has ever accepted. */
  unsent?: boolean
}

function row(topic: string, d: string, event: NostrEvent, flags: CacheFlags): CachedEvent {
  const r: CachedEvent = { topic, d, event }
  if (flags.pending) r.pending = true
  if (flags.unsent) r.unsent = true
  return r
}

export async function getCachedEvents(db: HippoDb, topic: string): Promise<CachedEvent[]> {
  return db.events.where('topic').equals(topic).toArray()
}

export async function getCachedEvent(db: HippoDb, topic: string, d: string): Promise<CachedEvent | undefined> {
  return db.events.get([topic, d])
}

export async function putCachedEvent(db: HippoDb, topic: string, d: string, event: NostrEvent, flags: CacheFlags = {}): Promise<void> {
  await db.events.put(row(topic, d, event, flags))
}

export async function deleteCachedEvent(db: HippoDb, topic: string, d: string): Promise<void> {
  await db.events.delete([topic, d])
}

export async function deleteCachedTopic(db: HippoDb, topic: string): Promise<void> {
  await db.events.where('topic').equals(topic).delete()
}

export async function countCachedEvents(db: HippoDb, topic: string): Promise<number> {
  return db.events.where('topic').equals(topic).count()
}

/**
 * Writes the event only if it is newer than the cached one for the slot
 * (PROTOCOL.md rule 7), inside a transaction so concurrent writers cannot
 * regress the slot. Writing the same event again only updates its flags.
 * Returns whether a new event was written.
 */
export async function cacheIfNewer(
  db: HippoDb,
  topic: string,
  d: string,
  event: NostrEvent,
  flags: CacheFlags = {},
): Promise<boolean> {
  return db.transaction('rw', db.events, async () => {
    const current = await db.events.get([topic, d])
    if (current) {
      const c = current.event
      if (c.id === event.id) {
        if (Boolean(current.pending) !== Boolean(flags.pending) || Boolean(current.unsent) !== Boolean(flags.unsent)) {
          await db.events.put(row(topic, d, event, flags))
        }
        return false
      }
      const newer = event.created_at > c.created_at || (event.created_at === c.created_at && event.id < c.id)
      if (!newer) return false
    }
    await db.events.put(row(topic, d, event, flags))
    return true
  })
}
