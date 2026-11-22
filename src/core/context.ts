// One-call setup for the app: database, transports and bound services.

import { RELAY_FORCE_QUERY_PARAM, RELAY_FORCE_STORAGE_KEY } from './config.ts'
import { openDb, type HippoDb } from './db/schema.ts'
import { sanitizeRelays } from './db/settings.ts'
import type { CoreDeps } from './services/deps.ts'
import { createNostrTransportProvider } from './transport/nostr.ts'
import type { Transport, TransportProvider } from './transport/types.ts'

export interface CreateCoreOptions {
  db?: HippoDb
  /** Database name; tests pass a unique one. */
  dbName?: string
  /** Use this transport (e.g. MemoryTransport) or provider instead of Nostr relays. */
  transport?: Transport | TransportProvider
  /** Force every transport onto these relays (overrides list, link and settings relays). */
  forceRelays?: string[]
  now?: () => number
}

export interface Core extends CoreDeps {
  /** Relays every transport is forced onto, when an override is active (end-to-end tests). */
  forcedRelays?: string[]
  close(): void
}

function readForcedRelaysFromStorage(): string[] | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(RELAY_FORCE_STORAGE_KEY)
    return raw ? sanitizeRelays(raw.split(',').map((s) => s.trim())) : undefined
  } catch {
    return undefined
  }
}

/**
 * Copies `?relays=ws://127.0.0.1:7447,...` from a URL into localStorage so a
 * reload keeps it. Returns the relays applied, if any. Call before
 * `createCore()`. Only loopback ws:// or wss:// URLs are accepted, so a
 * crafted link cannot silently point someone's app at an arbitrary relay
 * over plain text; the UI should still show when an override is active.
 */
export function applyRelayOverrideFromUrl(url: string | URL): string[] | undefined {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return undefined
  }
  const raw = u.searchParams.get(RELAY_FORCE_QUERY_PARAM)
  if (raw === null) return undefined
  const relays = sanitizeRelays(raw.split(',').map((s) => s.trim()).filter(isLoopbackRelay))
  try {
    if (relays) globalThis.localStorage?.setItem(RELAY_FORCE_STORAGE_KEY, relays.join(','))
    else globalThis.localStorage?.removeItem(RELAY_FORCE_STORAGE_KEY)
  } catch {
    // Storage unavailable (private mode); the override then lasts for this page only.
  }
  return relays
}

function isLoopbackRelay(url: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
  } catch {
    return false
  }
}

export function createCore(options: CreateCoreOptions = {}): Core {
  const db = options.db ?? openDb(options.dbName)
  const now = options.now ?? (() => Date.now())
  if (options.transport) {
    const t = options.transport
    const transports: TransportProvider = typeof t === 'function' ? t : () => t
    return {
      db,
      transports,
      now,
      close: () => {
        if (typeof t !== 'function') t.close()
        db.close()
      },
    }
  }
  const forced = options.forceRelays ? sanitizeRelays(options.forceRelays) : readForcedRelaysFromStorage()
  const nostr = createNostrTransportProvider()
  const transports: TransportProvider = forced ? () => nostr.provider(forced) : nostr.provider
  const core: Core = {
    db,
    transports,
    now,
    close: () => {
      nostr.close()
      db.close()
    },
  }
  if (forced) core.forcedRelays = forced
  return core
}
