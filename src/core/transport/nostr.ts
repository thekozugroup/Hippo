// Transport over public Nostr relays using nostr-tools' SimplePool.

import { SimplePool } from 'nostr-tools/pool'
import { normalizeURL } from 'nostr-tools/utils'
import type { EoseInfo, Filter, NostrEvent, PublishResult, RelayResult, Transport, TransportProvider, Unsubscribe } from './types.ts'

export interface NostrTransportOptions {
  /** Share one pool (and its sockets) between transports for different relay sets. */
  pool?: SimplePool
  publishTimeoutMs?: number
  fetchTimeoutMs?: number
  /** How long a subscription waits for a relay's EOSE before treating it as done. */
  eoseTimeoutMs?: number
}

const DEFAULT_PUBLISH_TIMEOUT = 8000
const DEFAULT_FETCH_TIMEOUT = 6000
const DEFAULT_EOSE_TIMEOUT = 6000

function message(e: unknown): string {
  if (e instanceof Error) return e.message
  return typeof e === 'string' ? e : 'unknown error'
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(timer)
        reject(e instanceof Error ? e : new Error(message(e)))
      },
    )
  })
}

export class NostrTransport implements Transport {
  readonly relays: readonly string[]
  private readonly pool: SimplePool
  private readonly ownsPool: boolean
  private readonly publishTimeoutMs: number
  private readonly fetchTimeoutMs: number
  private readonly eoseTimeoutMs: number
  private readonly closers = new Set<() => void>()

  constructor(relays: readonly string[], options: NostrTransportOptions = {}) {
    this.relays = [...new Set(relays)]
    this.ownsPool = options.pool === undefined
    this.pool = options.pool ?? new SimplePool({ enableReconnect: true })
    this.publishTimeoutMs = options.publishTimeoutMs ?? DEFAULT_PUBLISH_TIMEOUT
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT
    this.eoseTimeoutMs = options.eoseTimeoutMs ?? DEFAULT_EOSE_TIMEOUT
  }

  async publish(event: NostrEvent): Promise<PublishResult> {
    let promises: Promise<string>[]
    try {
      promises = this.pool.publish([...this.relays], event, { maxWait: this.publishTimeoutMs })
    } catch (e) {
      return { ok: false, relays: this.relays.map((relay) => ({ relay, ok: false, message: message(e) })) }
    }
    const settled = await Promise.allSettled(
      promises.map((p) => withTimeout(p, this.publishTimeoutMs + 500, 'publish timed out')),
    )
    const relays: RelayResult[] = settled.map((s, i) => {
      const relay = this.relays[i] ?? ''
      if (s.status === 'fulfilled') return { relay, ok: true, message: s.value }
      return { relay, ok: false, message: message(s.reason) }
    })
    return { ok: relays.some((r) => r.ok), relays }
  }

  subscribe(filter: Filter, onEvent: (e: NostrEvent) => void, onEose?: (info: EoseInfo) => void): Unsubscribe {
    let closed = false
    let eosed = false
    const fireEose = (): void => {
      if (eosed || closed) return
      eosed = true
      onEose?.(this.connectionInfo())
    }
    // SimplePool reports EOSE only when every relay has answered or failed;
    // this guard covers a relay that accepts the socket but never answers.
    const guard = setTimeout(fireEose, this.eoseTimeoutMs + 1000)
    let sub: { close: (reason?: string) => void } | undefined
    try {
      sub = this.pool.subscribe([...this.relays], filter, {
        maxWait: this.eoseTimeoutMs,
        onevent: (e) => {
          if (!closed) onEvent(e)
        },
        oneose: () => {
          clearTimeout(guard)
          fireEose()
        },
        onclose: () => {
          clearTimeout(guard)
          fireEose()
        },
      })
    } catch {
      clearTimeout(guard)
      queueMicrotask(fireEose)
    }
    const unsubscribe = (): void => {
      if (closed) return
      closed = true
      clearTimeout(guard)
      try {
        sub?.close()
      } catch {
        // Closing a subscription on a dead socket is harmless.
      }
      this.closers.delete(unsubscribe)
    }
    this.closers.add(unsubscribe)
    return unsubscribe
  }

  private connectionInfo(): EoseInfo {
    const status = this.pool.listConnectionStatus()
    let relaysReached = 0
    for (const r of this.relays) {
      try {
        if (status.get(normalizeURL(r))) relaysReached++
      } catch {
        // An unparsable relay URL is simply not reached.
      }
    }
    return { relaysReached, relaysTotal: this.relays.length }
  }

  fetch(filter: Filter, opts: { timeoutMs?: number } = {}): Promise<NostrEvent[]> {
    const timeoutMs = opts.timeoutMs ?? this.fetchTimeoutMs
    return new Promise((resolve) => {
      const seen = new Map<string, NostrEvent>()
      let done = false
      let unsubscribe: Unsubscribe = () => undefined
      const finish = (): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        unsubscribe()
        resolve([...seen.values()])
      }
      const timer = setTimeout(finish, timeoutMs)
      unsubscribe = this.subscribe(
        filter,
        (e) => {
          if (!seen.has(e.id)) seen.set(e.id, e)
        },
        () => queueMicrotask(finish),
      )
      if (done) unsubscribe()
    })
  }

  close(): void {
    for (const c of [...this.closers]) c()
    if (this.ownsPool) {
      try {
        this.pool.destroy()
      } catch {
        // Already closed.
      }
    }
  }
}

/** One shared pool; one transport per distinct relay set. */
export function createNostrTransportProvider(options: Omit<NostrTransportOptions, 'pool'> = {}): {
  provider: TransportProvider
  close: () => void
} {
  const pool = new SimplePool({ enableReconnect: true })
  const cache = new Map<string, NostrTransport>()
  const provider: TransportProvider = (relays) => {
    const key = [...relays].sort().join(',')
    let t = cache.get(key)
    if (!t) {
      t = new NostrTransport(relays, { ...options, pool })
      cache.set(key, t)
    }
    return t
  }
  return {
    provider,
    close: () => {
      for (const t of cache.values()) t.close()
      cache.clear()
      try {
        pool.destroy()
      } catch {
        // Already closed.
      }
    },
  }
}
