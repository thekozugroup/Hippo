// Storage semantics shared by MemoryTransport and the mock relay: NIP-01
// replaceable / addressable replacement, NIP-40 expiration, filter queries.

import { matchFilter } from 'nostr-tools/filter'
import type { Filter, NostrEvent } from './types.ts'

export function replacementKey(e: NostrEvent): string | null {
  if (e.kind === 0 || e.kind === 3 || (e.kind >= 10000 && e.kind < 20000)) return `${e.kind}:${e.pubkey}`
  if (e.kind >= 30000 && e.kind < 40000) {
    const d = e.tags.find((t) => t[0] === 'd')?.[1] ?? ''
    return `${e.kind}:${e.pubkey}:${d}`
  }
  return null
}

export function isEphemeral(e: NostrEvent): boolean {
  return e.kind >= 20000 && e.kind < 30000
}

export function expiresAt(e: NostrEvent): number | undefined {
  const v = e.tags.find((t) => t[0] === 'expiration')?.[1]
  if (v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export type StoreOutcome = 'stored' | 'duplicate' | 'replaced-newer-exists' | 'expired' | 'ephemeral'

export class RelayStore {
  private readonly byId = new Map<string, NostrEvent>()
  private readonly byKey = new Map<string, string>()
  private readonly nowSeconds: () => number

  constructor(nowSeconds: () => number = () => Math.floor(Date.now() / 1000)) {
    this.nowSeconds = nowSeconds
  }

  add(e: NostrEvent): StoreOutcome {
    if (this.byId.has(e.id)) return 'duplicate'
    const exp = expiresAt(e)
    if (exp !== undefined && exp <= this.nowSeconds()) return 'expired'
    if (isEphemeral(e)) return 'ephemeral'
    const key = replacementKey(e)
    if (key !== null) {
      const currentId = this.byKey.get(key)
      const current = currentId === undefined ? undefined : this.byId.get(currentId)
      if (current) {
        const newer = e.created_at > current.created_at || (e.created_at === current.created_at && e.id < current.id)
        if (!newer) return 'replaced-newer-exists'
        this.byId.delete(current.id)
      }
      this.byKey.set(key, e.id)
    }
    this.byId.set(e.id, e)
    return 'stored'
  }

  /** Newest first, honouring `limit` like a relay would. */
  query(filter: Filter): NostrEvent[] {
    const now = this.nowSeconds()
    const out = [...this.byId.values()].filter((e) => {
      const exp = expiresAt(e)
      return (exp === undefined || exp > now) && matchFilter(filter, e)
    })
    out.sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1))
    return filter.limit !== undefined ? out.slice(0, filter.limit) : out
  }

  all(): NostrEvent[] {
    return [...this.byId.values()]
  }

  delete(id: string): void {
    const e = this.byId.get(id)
    if (!e) return
    this.byId.delete(id)
    const key = replacementKey(e)
    if (key !== null && this.byKey.get(key) === id) this.byKey.delete(key)
  }

  clear(): void {
    this.byId.clear()
    this.byKey.clear()
  }
}
