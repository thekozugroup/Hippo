import type { Clock } from '../clock.ts'
import type { HippoDb } from '../db/schema.ts'
import type { TransportProvider } from '../transport/types.ts'

/** Everything a service needs, injected so tests can use MemoryTransport and a fake clock. */
export interface CoreDeps {
  db: HippoDb
  transports: TransportProvider
  /** Milliseconds since epoch, corrected for a wrong device clock when the app measured one (`Clock`). Every time a service stamps or judges comes from here. */
  now: () => number
  /**
   * The clock behind `now`, when it can change its mind: a giver session waits briefly for its
   * first measurement before judging events, and listens again when the offset changes.
   */
  clockSync?: Pick<Clock, 'ready' | 'subscribe' | 'offset'>
}
