import type { NostrEvent } from 'nostr-tools/core'
import type { CachedEvent, HippoDb } from './schema.ts'

export async function getCachedEvents(db: HippoDb, topic: string): Promise<CachedEvent[]> {
  return db.events.where('topic').equals(topic).toArray()
}

export async function getCachedEvent(db: HippoDb, topic: string, d: string): Promise<CachedEvent | undefined> {
  return db.events.get([topic, d])
}

export async function putCachedEvent(
  db: HippoDb,
  topic: string,
  d: string,
  event: NostrEvent,
  pending = false,
): Promise<void> {
  const row: CachedEvent = { topic, d, event }
  if (pending) row.pending = true
  await db.events.put(row)
}

export async function deleteCachedTopic(db: HippoDb, topic: string): Promise<void> {
  await db.events.where('topic').equals(topic).delete()
}

/**
 * Writes the event only if it is newer than the cached one for the slot
 * (PROTOCOL.md rule 7), inside a transaction so concurrent writers cannot
 * regress the slot. Returns whether it was written.
 */
export async function cacheIfNewer(
  db: HippoDb,
  topic: string,
  d: string,
  event: NostrEvent,
  pending = false,
): Promise<boolean> {
  return db.transaction('rw', db.events, async () => {
    const current = await db.events.get([topic, d])
    if (current) {
      const c = current.event
      if (c.id === event.id) {
        if (current.pending && !pending) await db.events.put({ topic, d, event })
        return false
      }
      const newer = event.created_at > c.created_at || (event.created_at === c.created_at && event.id < c.id)
      if (!newer) return false
    }
    const row: CachedEvent = { topic, d, event }
    if (pending) row.pending = true
    await db.events.put(row)
    return true
  })
}
