// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { RELAY_FORCE_STORAGE_KEY } from './config.ts'
import { applyRelayOverrideFromUrl, createCore, readRelayOverride } from './context.ts'
import { randomId } from './crypto/bytes.ts'
import { MemoryTransport } from './transport/memory.ts'
import { NostrTransport } from './transport/nostr.ts'

class MapStorage {
  private m = new Map<string, string>()
  getItem(k: string): string | null {
    return this.m.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v)
  }
  removeItem(k: string): void {
    this.m.delete(k)
  }
}

const g = globalThis as { localStorage?: unknown; sessionStorage?: unknown }
afterEach(() => {
  delete g.localStorage
  delete g.sessionStorage
})

describe('createCore', () => {
  it('uses an injected MemoryTransport', () => {
    const t = new MemoryTransport()
    const core = createCore({ transport: t, dbName: `hippo-test-${randomId()}` })
    expect(core.transports(['wss://a.example'])).toBe(t)
    core.close()
  })

  it('defaults to Nostr transports per relay set', () => {
    const core = createCore({ dbName: `hippo-test-${randomId()}` })
    const t = core.transports(['wss://a.example'])
    expect(t).toBeInstanceOf(NostrTransport)
    expect((t as NostrTransport).relays).toEqual(['wss://a.example'])
    expect(core.transports(['wss://a.example'])).toBe(t)
    expect(core.forcedRelays).toBeUndefined()
    core.close()
  })

  it('forces loopback relays from the URL parameter for this tab only (sessionStorage)', () => {
    g.sessionStorage = new MapStorage()
    g.localStorage = new MapStorage()
    ;(g.localStorage as MapStorage).setItem(RELAY_FORCE_STORAGE_KEY, 'ws://127.0.0.1:1') // from an older build
    expect(applyRelayOverrideFromUrl('http://localhost:5173/?relays=ws://127.0.0.1:7447,wss://evil.example')).toEqual(['ws://127.0.0.1:7447'])
    expect((g.localStorage as MapStorage).getItem(RELAY_FORCE_STORAGE_KEY)).toBeNull()
    expect(readRelayOverride()).toEqual(['ws://127.0.0.1:7447'])
    const core = createCore({ dbName: `hippo-test-${randomId()}` })
    expect(core.forcedRelays).toEqual(['ws://127.0.0.1:7447'])
    expect((core.transports(['wss://relay.damus.io']) as NostrTransport).relays).toEqual(['ws://127.0.0.1:7447'])
    core.close()
    expect(applyRelayOverrideFromUrl('http://localhost:5173/?relays=')).toBeUndefined()
    expect((g.sessionStorage as MapStorage).getItem(RELAY_FORCE_STORAGE_KEY)).toBeNull()
  })

  it('ignores non-loopback relays in the override, wherever they come from', () => {
    g.sessionStorage = new MapStorage()
    ;(g.sessionStorage as MapStorage).setItem(RELAY_FORCE_STORAGE_KEY, 'wss://evil.example,ws://10.0.0.1:7447')
    expect(readRelayOverride()).toBeUndefined()
    const core = createCore({ dbName: `hippo-test-${randomId()}` })
    expect(core.forcedRelays).toBeUndefined()
    core.close()
    expect(applyRelayOverrideFromUrl('https://hippo.example/?relays=wss://relay.evil.example')).toBeUndefined()
    const forced = createCore({ dbName: `hippo-test-${randomId()}`, forceRelays: ['wss://evil.example', 'ws://localhost:7447'] })
    expect(forced.forcedRelays).toEqual(['ws://localhost:7447'])
    forced.close()
  })
})
