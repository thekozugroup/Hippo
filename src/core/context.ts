// One-call setup for the app: database, transports and bound services.

import { RELAY_FORCE_QUERY_PARAM, RELAY_FORCE_STORAGE_KEY } from './config.ts'
import { openDb, type HippoDb } from './db/schema.ts'
import { isLoopbackRelayUrl } from './model/validate.ts'
import type { CoreDeps } from './services/deps.ts'
import { createNostrTransportProvider } from './transport/nostr.ts'
import type { Transport, TransportProvider } from './transport/types.ts'

export interface CreateCoreOptions {
  db?: HippoDb
  /** Database name; tests pass a unique one. */
  dbName?: string
  /** Use this transport (e.g. MemoryTransport) or provider instead of Nostr relays. */
  transport?: Transport | TransportProvider
  /** Force every transport onto these loopback relays (overrides list, link and settings relays). */
  forceRelays?: string[]
  now?: () => number
}

export interface Core extends CoreDeps {
  /** Loopback relays every transport is forced onto, when the developer override is active. Show a notice. */
  forcedRelays?: string[]
  close(): void
}

/** The developer relay override accepts loopback `ws://` / `wss://` URLs only (at most 20). */
export function sanitizeOverrideRelays(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const relays = value.filter((v): v is string => typeof v === 'string' && isLoopbackRelayUrl(v))
  return relays.length > 0 ? [...new Set(relays)].slice(0, 20) : undefined
}

function sessionStore(): Storage | undefined {
  try {
    return globalThis.sessionStorage ?? undefined
  } catch {
    return undefined
  }
}

/**
 * The developer relay override for this browser tab, if one is active. It
 * lives in sessionStorage, so it ends with the tab; only loopback relays are
 * honoured. The UI should show a notice while it is active.
 */
export function readRelayOverride(): string[] | undefined {
  try {
    const raw = sessionStore()?.getItem(RELAY_FORCE_STORAGE_KEY)
    return raw ? sanitizeOverrideRelays(raw.split(',').map((s) => s.trim())) : undefined
  } catch {
    return undefined
  }
}

/**
 * Copies `?relays=ws://127.0.0.1:7447,...` from a URL into sessionStorage so
 * a reload in the same tab keeps it. Returns the relays applied, if any. Call
 * before `createCore()`. Only loopback relays are accepted, and the override
 * ends with the tab, so a crafted link cannot redirect the app elsewhere or
 * for good. Also removes the persistent localStorage value older builds used.
 */
export function applyRelayOverrideFromUrl(url: string | URL): string[] | undefined {
  try {
    globalThis.localStorage?.removeItem(RELAY_FORCE_STORAGE_KEY)
  } catch {
    // Storage unavailable.
  }
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return undefined
  }
  const raw = u.searchParams.get(RELAY_FORCE_QUERY_PARAM)
  if (raw === null) return undefined
  const relays = sanitizeOverrideRelays(raw.split(',').map((s) => s.trim()))
  try {
    const store = sessionStore()
    if (relays) store?.setItem(RELAY_FORCE_STORAGE_KEY, relays.join(','))
    else store?.removeItem(RELAY_FORCE_STORAGE_KEY)
  } catch {
    // Storage unavailable (private mode); the override then lasts for this page only.
  }
  return relays
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
  const forced = options.forceRelays ? sanitizeOverrideRelays(options.forceRelays) : readRelayOverride()
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
