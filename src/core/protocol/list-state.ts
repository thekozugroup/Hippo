// In-memory state of one shared list as seen by a client: the current
// accepted event per slot, with PROTOCOL.md section 5 rule 5 (first author
// owns a claim slot) and rule 7 (last writer wins per slot and author).

import type { NostrEvent } from 'nostr-tools/core'
import { LIMITS } from '../model/limits.ts'
import type { AcceptedEvent, ReceiveContext, RejectReason } from './receive.ts'
import { compareFirstSeen, isNewer, receiveEvent } from './receive.ts'

export type IngestOutcome = 'accepted' | 'duplicate' | 'stale' | 'slot-taken' | 'too-many' | RejectReason

export type AcceptedMeta = Extract<AcceptedEvent, { type: 'meta' }>
export type AcceptedItem = Extract<AcceptedEvent, { type: 'item' }>
export type AcceptedClaim = Extract<AcceptedEvent, { type: 'claim' }>

export class ListState {
  readonly ctx: ReceiveContext
  private readonly slots = new Map<string, AcceptedEvent>()
  /**
   * First author seen per claim slot. Kept separately from `slots` so the
   * owner of a slot never changes, even when its current event is replaced.
   */
  private readonly slotAuthors = new Map<string, string>()

  constructor(ctx: ReceiveContext) {
    this.ctx = ctx
  }

  ingest(raw: unknown): { outcome: IngestOutcome; accepted?: AcceptedEvent } {
    const r = receiveEvent(raw, this.ctx)
    if (!r.ok) return { outcome: r.reason }
    const a = r.accepted
    if (a.type === 'claim') {
      const author = this.slotAuthors.get(a.d)
      if (author !== undefined && author !== a.event.pubkey) return { outcome: 'slot-taken' }
      // Bound memory and cache growth: new claim slots beyond the cap are ignored.
      if (author === undefined && this.slotAuthors.size >= LIMITS.claimsPerList) return { outcome: 'too-many' }
    }
    const current = this.slots.get(a.d)
    if (current) {
      if (current.event.id === a.event.id) return { outcome: 'duplicate' }
      if (!isNewer(a.event, current.event)) return { outcome: 'stale' }
    }
    if (a.type === 'claim') this.slotAuthors.set(a.d, a.event.pubkey)
    this.slots.set(a.d, a)
    return { outcome: 'accepted', accepted: a }
  }

  /**
   * Ingests a batch in first-seen order (lower created_at, then lower id) so
   * that competing authors in one batch resolve the way rule 5 specifies.
   * Returns the events that became current.
   */
  ingestBatch(raws: readonly NostrEvent[]): AcceptedEvent[] {
    const sorted = [...raws].sort(compareFirstSeen)
    const out: AcceptedEvent[] = []
    for (const raw of sorted) {
      const r = this.ingest(raw)
      if (r.accepted) out.push(r.accepted)
    }
    return out
  }

  get(d: string): AcceptedEvent | undefined {
    return this.slots.get(d)
  }

  get meta(): AcceptedMeta | undefined {
    for (const a of this.slots.values()) if (a.type === 'meta') return a
    return undefined
  }

  items(): Map<string, AcceptedItem> {
    const out = new Map<string, AcceptedItem>()
    for (const a of this.slots.values()) if (a.type === 'item') out.set(a.itemId, a)
    return out
  }

  claims(): AcceptedClaim[] {
    const out: AcceptedClaim[] = []
    for (const a of this.slots.values()) if (a.type === 'claim') out.push(a)
    return out
  }

  all(): AcceptedEvent[] {
    return [...this.slots.values()]
  }
}
