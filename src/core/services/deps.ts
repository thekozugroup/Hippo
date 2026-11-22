import type { HippoDb } from '../db/schema.ts'
import type { TransportProvider } from '../transport/types.ts'

/** Everything a service needs, injected so tests can use MemoryTransport and a fake clock. */
export interface CoreDeps {
  db: HippoDb
  transports: TransportProvider
  /** Milliseconds since epoch. */
  now: () => number
}
