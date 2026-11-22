import type { NostrEvent } from 'nostr-tools/core'
import type { Filter } from 'nostr-tools/filter'

export type { NostrEvent, Filter }

export interface RelayResult {
  relay: string
  ok: boolean
  /** Relay message on OK, or the error / timeout reason. */
  message?: string
}

export interface PublishResult {
  /** True when at least one relay accepted the event. */
  ok: boolean
  relays: RelayResult[]
}

export type Unsubscribe = () => void

/**
 * Passed to `onEose`. An addition to PROTOCOL.md's signature (callers may
 * ignore it): SimplePool also signals EOSE when every relay failed, and the
 * giver view needs to tell "caught up" from "offline".
 */
export interface EoseInfo {
  relaysReached: number
  relaysTotal: number
}

/** PROTOCOL.md section 7. Implementations never throw for a single relay failure. */
export interface Transport {
  publish(event: NostrEvent): Promise<PublishResult>
  subscribe(filter: Filter, onEvent: (e: NostrEvent) => void, onEose?: (info: EoseInfo) => void): Unsubscribe
  fetch(filter: Filter, opts?: { timeoutMs?: number }): Promise<NostrEvent[]>
  close(): void
}

/**
 * Shared lists and guest lists each carry their own relay list, so services
 * ask for a transport per relay set.
 */
export type TransportProvider = (relays: readonly string[]) => Transport

/** A provider that ignores relay lists; used with MemoryTransport in tests. */
export function staticTransport(t: Transport): TransportProvider {
  return () => t
}
