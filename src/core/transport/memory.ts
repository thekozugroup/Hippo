// In-process transport for tests and the offline demo. Several
// MemoryTransport instances can share one RelayStore to act as one network.

import { matchFilter } from 'nostr-tools/filter'
import { verifyEvent } from 'nostr-tools/pure'
import { sanitizeEvent } from '../protocol/receive.ts'
import { RelayStore } from './relay-store.ts'
import type { EoseInfo, Filter, NostrEvent, PublishResult, Transport, Unsubscribe } from './types.ts'

interface Sub {
  filter: Filter
  onEvent: (e: NostrEvent) => void
}

/** A shared in-memory "relay" that several MemoryTransports can attach to. */
export class MemoryNetwork {
  readonly store = new RelayStore()
  private readonly subs = new Set<Sub>()

  attach(sub: Sub): () => void {
    this.subs.add(sub)
    return () => this.subs.delete(sub)
  }

  broadcast(e: NostrEvent): void {
    for (const s of this.subs) if (matchFilter(s.filter, e)) s.onEvent(e)
  }
}

export interface MemoryTransportOptions {
  network?: MemoryNetwork
  /** Name reported in publish results. */
  name?: string
}

export class MemoryTransport implements Transport {
  readonly network: MemoryNetwork
  readonly name: string
  /** When true every operation behaves as if no relay is reachable. */
  offline = false
  /** Every filter passed to subscribe/fetch; tests use it to audit access. */
  readonly filterLog: Filter[] = []
  private readonly detachers = new Set<() => void>()

  constructor(options: MemoryTransportOptions = {}) {
    this.network = options.network ?? new MemoryNetwork()
    this.name = options.name ?? 'memory'
  }

  async publish(event: NostrEvent): Promise<PublishResult> {
    await Promise.resolve()
    if (this.offline) return { ok: false, relays: [{ relay: this.name, ok: false, message: 'offline' }] }
    const clean = sanitizeEvent(event)
    if (!clean || !verifyEvent(clean)) {
      return { ok: false, relays: [{ relay: this.name, ok: false, message: 'invalid: bad signature' }] }
    }
    const outcome = this.network.store.add(clean)
    if (outcome === 'stored') this.network.broadcast(clean)
    const ok = outcome !== 'expired'
    return { ok, relays: [{ relay: this.name, ok, message: outcome }] }
  }

  subscribe(filter: Filter, onEvent: (e: NostrEvent) => void, onEose?: (info: EoseInfo) => void): Unsubscribe {
    this.filterLog.push(structuredClone(filter))
    let active = true
    // Deliver asynchronously, like a socket would, so callers never re-enter.
    const sub: Sub = {
      filter,
      onEvent: (e) =>
        queueMicrotask(() => {
          if (active) onEvent(e)
        }),
    }
    queueMicrotask(() => {
      if (!active || this.offline) return
      for (const e of this.network.store.query(filter).reverse()) onEvent(e)
      onEose?.({ relaysReached: 1, relaysTotal: 1 })
    })
    const detach = this.offline ? () => undefined : this.network.attach(sub)
    const unsubscribe = (): void => {
      active = false
      detach()
      this.detachers.delete(unsubscribe)
    }
    this.detachers.add(unsubscribe)
    return unsubscribe
  }

  async fetch(filter: Filter): Promise<NostrEvent[]> {
    this.filterLog.push(structuredClone(filter))
    await Promise.resolve()
    if (this.offline) return []
    return this.network.store.query(filter)
  }

  close(): void {
    for (const d of [...this.detachers]) d()
  }
}
