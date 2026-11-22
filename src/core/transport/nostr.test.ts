// @vitest-environment node
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { useWebSocketImplementation } from 'nostr-tools/pool'
import WebSocket from 'ws'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomId } from '../crypto/bytes.ts'
import { publicKeyOf } from '../crypto/keys.ts'
import { openDb } from '../db/schema.ts'
import { addGuestListFromLink, openGuestList } from '../services/giver-lists.ts'
import { buildShareLink, createSharedList, publishList, repairOwnerList } from '../services/owner-lists.ts'
import type { CoreDeps } from '../services/deps.ts'
import { createItem } from '../services/wishlist.ts'
import { startMockRelay, type MockRelay } from '../testing/mock-relay.ts'
import { waitFor } from '../testing/fixtures.ts'
import { NostrTransport, createNostrTransportProvider } from './nostr.ts'
import type { EoseInfo, NostrEvent } from './types.ts'

// Nothing listens on port 1; connections are refused immediately.
const DEAD = 'ws://127.0.0.1:1'

let relay: MockRelay
const transports: NostrTransport[] = []

// Node's built-in WebSocket re-fires `error` synchronously when nostr-tools
// calls close() from its onerror handler on a refused connection, which
// recurses until the stack overflows. Browsers do not do this; under Node we
// use the `ws` client instead.
useWebSocketImplementation(WebSocket)

beforeAll(async () => {
  relay = await startMockRelay()
})
afterAll(async () => {
  await relay.close()
})
afterEach(() => {
  for (const t of transports.splice(0)) t.close()
  relay.clear()
})

function transport(relays: string[]): NostrTransport {
  const t = new NostrTransport(relays, { publishTimeoutMs: 2000, fetchTimeoutMs: 2000, eoseTimeoutMs: 2000 })
  transports.push(t)
  return t
}

const sk = generateSecretKey()
function event(d: string, createdAt: number, content = 'hello', topic = 'topic-a'): NostrEvent {
  return finalizeEvent({ kind: 30078, created_at: createdAt, tags: [['d', d], ['t', topic]], content }, sk)
}

describe('NostrTransport against the mock relay', () => {
  it('publishes, fetches and reports per relay', async () => {
    const t = transport([relay.url])
    const e = event('slot-1', 1000)
    const r = await t.publish(e)
    expect(r).toEqual({ ok: true, relays: [{ relay: relay.url, ok: true, message: '' }] })
    const got = await t.fetch({ kinds: [30078], '#t': ['topic-a'] })
    expect(got.map((x) => x.id)).toEqual([e.id])
  })

  it('subscribes: stored events, EOSE, then live events', async () => {
    const t = transport([relay.url])
    const stored = event('slot-1', 1000)
    await t.publish(stored)
    const seen: string[] = []
    let eose: EoseInfo | undefined
    const unsub = t.subscribe({ kinds: [30078], '#t': ['topic-a'] }, (e) => seen.push(e.id), (info) => (eose = info))
    await waitFor(() => eose !== undefined)
    expect(eose).toEqual({ relaysReached: 1, relaysTotal: 1 })
    expect(seen).toEqual([stored.id])
    const live = event('slot-2', 1001)
    await t.publish(live)
    await waitFor(() => seen.length === 2)
    expect(seen[1]).toBe(live.id)
    unsub()
    await t.publish(event('slot-3', 1002))
    await new Promise((r) => setTimeout(r, 100))
    expect(seen).toHaveLength(2)
  })

  it('replaces addressable events by created_at; older never replaces newer', async () => {
    const t = transport([relay.url])
    const v1 = event('slot', 1000, 'v1')
    const v2 = event('slot', 2000, 'v2')
    await t.publish(v1)
    await t.publish(v2)
    expect((await t.fetch({ '#d': ['slot'] })).map((e) => e.content)).toEqual(['v2'])
    const stale = await t.publish(event('slot', 1500, 'stale'))
    expect(stale.ok).toBe(true)
    expect((await t.fetch({ '#d': ['slot'] })).map((e) => e.content)).toEqual(['v2'])
    expect(relay.events).toHaveLength(1)
  })

  it('honours authors, since and limit filters', async () => {
    const t = transport([relay.url])
    await t.publish(event('a', 1000))
    await t.publish(event('b', 2000))
    await t.publish(event('c', 3000))
    const other = finalizeEvent({ kind: 30078, created_at: 4000, tags: [['d', 'x'], ['t', 'topic-a']], content: '' }, generateSecretKey())
    await t.publish(other)
    const me = publicKeyOf(Buffer.from(sk).toString('hex'))
    expect(await t.fetch({ authors: [me] })).toHaveLength(3)
    expect((await t.fetch({ authors: [me], since: 2000 })).map((e) => e.created_at).sort()).toEqual([2000, 3000])
    expect((await t.fetch({ '#t': ['topic-a'], limit: 2 })).map((e) => e.created_at).sort()).toEqual([3000, 4000])
  })

  it('rejects forged events', async () => {
    const t = transport([relay.url])
    const e = event('slot', 1000)
    const r = await t.publish({ ...e, content: 'tampered' })
    expect(r.ok).toBe(false)
    expect(r.relays[0]?.message).toMatch(/invalid/)
    expect(relay.events).toHaveLength(0)
  })

  it('tolerates a dead relay in the list', async () => {
    const t = transport([DEAD, relay.url])
    const e = event('slot', 1000)
    const r = await t.publish(e)
    expect(r.ok).toBe(true)
    expect(r.relays.map((x) => [x.relay, x.ok])).toEqual([
      [DEAD, false],
      [relay.url, true],
    ])
    expect(r.relays[0]?.message).toBeTruthy()
    expect((await t.fetch({ '#d': ['slot'] })).map((x) => x.id)).toEqual([e.id])
    let eose: EoseInfo | undefined
    const unsub = t.subscribe({ '#d': ['slot'] }, () => undefined, (info) => (eose = info))
    await waitFor(() => eose !== undefined)
    expect(eose).toEqual({ relaysReached: 1, relaysTotal: 2 })
    unsub()
  })

  it('reports failure without throwing when every relay is dead', async () => {
    const t = transport([DEAD])
    const r = await t.publish(event('slot', 1000))
    expect(r.ok).toBe(false)
    expect(await t.fetch({ '#d': ['slot'] }, { timeoutMs: 1000 })).toEqual([])
    let eose: EoseInfo | undefined
    t.subscribe({ '#d': ['slot'] }, () => undefined, (info) => (eose = info))
    await waitFor(() => eose !== undefined, 5000)
    expect(eose?.relaysReached).toBe(0)
  })

  it('runs the owner and giver flow over real sockets; owner REQs always carry authors', async () => {
    const { provider, close } = createNostrTransportProvider({ publishTimeoutMs: 2000, fetchTimeoutMs: 2000, eoseTimeoutMs: 2000 })
    try {
      const now = () => Date.now()
      const ownerDeps: CoreDeps = { db: openDb(`hippo-test-${randomId()}`), transports: provider, now }
      await ownerDeps.db.settings.put({ key: 'relays', value: [relay.url] })
      const item = await createItem(ownerDeps.db, { title: 'Hippo' })
      const list = await createSharedList(ownerDeps, { name: 'Zoo', itemIds: [item.id] })
      expect(list.relays).toEqual([relay.url])
      expect((await publishList(ownerDeps, list.id)).ok).toBe(true)
      const link = buildShareLink(list, 'http://localhost:5173/')

      const giverDeps: CoreDeps = { db: openDb(`hippo-test-${randomId()}`), transports: provider, now }
      const guest = await addGuestListFromLink(giverDeps, link)
      expect(guest.relays).toEqual([relay.url])
      const session = await openGuestList(giverDeps, guest.topic, { eoseTimeoutMs: 3000 })
      await session.start()
      await waitFor(() => session.getSnapshot().status === 'live' && session.getSnapshot().items.length === 1)
      const { result } = await session.claim(item.id)
      expect(result.ok).toBe(true)
      await waitFor(() => session.getSnapshot().items[0]?.state.status === 'claimed')
      session.stop()

      const before = relay.filters.length
      await repairOwnerList(ownerDeps, list.id)
      const ownerFilters = relay.filters.slice(before)
      expect(ownerFilters.length).toBeGreaterThan(0)
      for (const f of ownerFilters) expect(f.authors).toEqual([publicKeyOf(list.ownerSecretKey)])
      expect((await ownerDeps.db.events.toArray()).every((r) => r.event.pubkey === publicKeyOf(list.ownerSecretKey))).toBe(true)
    } finally {
      close()
    }
  })
})
