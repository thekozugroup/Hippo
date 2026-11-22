// @vitest-environment node
// Regression tests for the security review of src/core (rotation durability,
// FR-25, claim ordering, metadata, expiry, relay URLs, hostile imports).
import { afterEach, describe, expect, it } from 'vitest'
import { randomId } from '../crypto/bytes.ts'
import { deriveListKeys, generateListSecret, generateSigningKey, publicKeyOf } from '../crypto/keys.ts'
import { encodeSharePayload, buildShareUrl, parseShareLink } from '../crypto/link.ts'
import { openDb } from '../db/schema.ts'
import { isHippoError } from '../errors.ts'
import { LIMITS } from '../model/limits.ts'
import type { ClaimPayload } from '../model/types.ts'
import { isLoopbackRelayUrl, isRelayUrl, parseListMetaPayload } from '../model/validate.ts'
import { DAY, buildClaimEvent, buildMetaEvent, expirationFor, expirationOf } from '../protocol/build.ts'
import { ListState } from '../protocol/list-state.ts'
import { receiveEvent } from '../protocol/receive.ts'
import { claimSlot, metaSlot } from '../protocol/slots.ts'
import { testClock, testDevice, waitFor, type TestClock } from '../testing/fixtures.ts'
import { MemoryNetwork } from '../transport/memory.ts'
import { RelayStore } from '../transport/relay-store.ts'
import { exportData, importData } from './backup.ts'
import { addGuestListFromLink, buildGuestShareLink, openGuestList, type GiverListSession } from './giver-lists.ts'
import {
  buildShareLink,
  createSharedList,
  deleteSharedList,
  localItemIdFor,
  publishList,
  repairOwnerList,
  repairRetiredLists,
  rotateList,
  sharedItemIdFor,
  syncList,
  topicOfList,
  updateSharedList,
} from './owner-lists.ts'
import { createItem } from './wishlist.ts'

const BASE = 'https://hippo.example/'
const sessions: GiverListSession[] = []
afterEach(() => {
  for (const s of sessions.splice(0)) s.stop()
})

/** A network whose relay clock follows the test clock, so NIP-40 expiry can be exercised. */
function network(clock: TestClock): MemoryNetwork {
  return new MemoryNetwork({ nowSeconds: () => Math.floor(clock.now() / 1000) })
}

async function ownerWithList(net: MemoryNetwork, clock: TestClock, name = 'owner') {
  const owner = testDevice(net, clock, name)
  const scarf = await createItem(owner.db, { title: 'Scarf' }, clock.now())
  const list = await createSharedList(owner, { name: 'Birthday', itemIds: [scarf.id], eventDate: '2027-03-14' })
  expect((await publishList(owner, list.id)).ok).toBe(true)
  return { owner, scarf, list, link: buildShareLink(list, BASE) }
}

async function openAsGiver(net: MemoryNetwork, link: string, name: string, clock: TestClock = testClock()) {
  const device = testDevice(net, clock, name)
  const guest = await addGuestListFromLink(device, link)
  const session = await openGuestList(device, guest.topic, { eoseTimeoutMs: 200, retryMs: 50 })
  sessions.push(session)
  await session.start()
  await waitFor(() => session.getSnapshot().status !== 'loading')
  return { device, session, guest }
}

describe('rotation is durable (finding 1)', () => {
  it('keeps the old keys while offline, cuts the old link off once back online, then drops the secrets', async () => {
    const clock = testClock()
    const net = network(clock)
    const { owner, scarf, list, link } = await ownerWithList(net, clock)
    const oldTopic = topicOfList(list)

    owner.transport.offline = true
    const r = await rotateList(owner, list.id)
    expect(r.unpublishedOld.ok).toBe(false)
    const pending = await owner.db.retiredLists.get(oldTopic)
    expect(pending?.pending?.listSecret).toBe(list.listSecret)
    expect(pending?.pending?.itemIds).toEqual([sharedItemIdFor(list, scarf.id)])
    expect(await owner.db.events.where('topic').equals(oldTopic).count()).toBeGreaterThan(0)

    // Old link still live for now.
    const before = await openAsGiver(net, link, 'g1')
    expect(before.session.getSnapshot().status).toBe('live')
    expect(before.session.getSnapshot().items).toHaveLength(1)
    before.session.stop()

    // Back online: repair (here through the list's own repair) finishes the cut-off.
    owner.transport.offline = false
    await repairOwnerList(owner, list.id)
    const done = await owner.db.retiredLists.get(oldTopic)
    expect(done).toMatchObject({ topic: oldTopic, ownerPubkey: publicKeyOf(list.ownerSecretKey), reason: 'rotated' })
    expect(done?.pending).toBeUndefined()
    expect(await owner.db.events.where('topic').equals(oldTopic).count()).toBe(0)

    const after = await openAsGiver(net, link, 'g2')
    await waitFor(() => after.session.getSnapshot().status === 'unpublished')
    expect(after.session.getSnapshot().items).toEqual([])
  })

  it('recovers from a crash after the new keys were saved (nothing published yet)', async () => {
    const clock = testClock()
    const net = network(clock)
    const { owner, list, link } = await ownerWithList(net, clock)
    // Simulate a crash right after the rotation transaction: every publish fails.
    owner.transport.offline = true
    const { list: rotated } = await rotateList(owner, list.id)
    owner.transport.offline = false
    // On restart the app repairs retired lists and syncs the list.
    expect((await repairRetiredLists(owner)).every((r) => r.ok)).toBe(true)
    expect((await syncList(owner, rotated.id)).ok).toBe(true)
    const old = await openAsGiver(net, link, 'old')
    await waitFor(() => old.session.getSnapshot().status === 'unpublished')
    const fresh = await openAsGiver(net, buildShareLink(rotated, BASE), 'new')
    await waitFor(() => fresh.session.getSnapshot().items.length === 1)
  })

  it('deleting a published list while offline still cuts it off later', async () => {
    const clock = testClock()
    const net = network(clock)
    const { owner, list, link } = await ownerWithList(net, clock)
    owner.transport.offline = true
    const r = await deleteSharedList(owner, list.id)
    expect(r?.ok).toBe(false)
    expect(await owner.db.sharedLists.count()).toBe(0)
    owner.transport.offline = false
    await repairRetiredLists(owner)
    const g = await openAsGiver(net, link, 'g')
    await waitFor(() => g.session.getSnapshot().status === 'unpublished')
    expect((await owner.db.retiredLists.get(topicOfList(list)))?.pending).toBeUndefined()
  })
})

describe('FR-25 after rotation and deletion (finding 2)', () => {
  it('refuses the old link on the owner device after a rotation, even when the cut-off failed', async () => {
    const clock = testClock()
    const net = network(clock)
    const { owner, list, link } = await ownerWithList(net, clock)
    owner.transport.offline = true
    await rotateList(owner, list.id)
    owner.transport.offline = false
    await expect(addGuestListFromLink(owner, link)).rejects.toSatisfy((e: unknown) => isHippoError(e, 'own-list'))
    expect(await owner.db.guestLists.count()).toBe(0)
  })

  it('refuses the link of a deleted list, and a guest record added before is refused at open', async () => {
    const clock = testClock()
    const net = network(clock)
    const { owner, list, link } = await ownerWithList(net, clock)
    await deleteSharedList(owner, list.id)
    await expect(addGuestListFromLink(owner, link)).rejects.toSatisfy((e: unknown) => isHippoError(e, 'own-list'))
    // A guest record that slipped in (for example from an old backup) cannot be opened either.
    const keys = deriveListKeys(list.listSecret)
    await owner.db.guestLists.put({
      topic: keys.topic,
      ownerPubkey: publicKeyOf(list.ownerSecretKey),
      listSecret: list.listSecret,
      relays: list.relays,
      guestSecretKey: generateSigningKey(),
      addedAt: 1,
      lastOpenedAt: 1,
    })
    await expect(openGuestList(owner, keys.topic)).rejects.toSatisfy((e: unknown) => isHippoError(e, 'own-list'))
  })

  it('refuses a link that reuses an owned owner key with a different secret', async () => {
    const clock = testClock()
    const net = network(clock)
    const { owner, list } = await ownerWithList(net, clock)
    const payload = encodeSharePayload({ ownerPubkey: publicKeyOf(list.ownerSecretKey), listSecret: generateListSecret() })
    await expect(addGuestListFromLink(owner, buildShareUrl(BASE, payload))).rejects.toSatisfy((e: unknown) => isHippoError(e, 'own-list'))
  })
})

describe('claim ordering (finding 3)', () => {
  function setup() {
    const listSecret = generateListSecret()
    const keys = deriveListKeys(listSecret)
    const now = Date.UTC(2026, 10, 1)
    const ctx = { topic: keys.topic, ownerPubkey: publicKeyOf(generateSigningKey()), contentKey: keys.contentKey, claimsKey: keys.claimsKey, now: () => now }
    const claim = (extra: Partial<ClaimPayload> = {}): ClaimPayload => ({
      v: 1, id: randomId(), itemId: randomId(), kind: 'full', status: 'reserved', createdAt: now, updatedAt: now, ...extra,
    })
    const sign = (p: ClaimPayload, createdAtSec = Math.floor(now / 1000)) =>
      buildClaimEvent(p, keys.claimsKey, { topic: keys.topic, secretKey: generateSigningKey(), createdAt: createdAtSec })
    return { now, ctx, claim, sign }
  }

  it('rejects claims dated more than 10 minutes in the future (payload or event)', () => {
    const { now, ctx, claim, sign } = setup()
    const skew = LIMITS.futureSkewMs
    expect(receiveEvent(sign(claim({ createdAt: now + skew - 1000 })), ctx).ok).toBe(true)
    expect(receiveEvent(sign(claim({ createdAt: now + skew + 1000 })), ctx)).toEqual({ ok: false, reason: 'future' })
    expect(receiveEvent(sign(claim({ updatedAt: now + skew + 1000 })), ctx)).toEqual({ ok: false, reason: 'future' })
    expect(receiveEvent(sign(claim(), Math.floor((now + skew) / 1000) + 5), ctx)).toEqual({ ok: false, reason: 'future' })
  })

  it('a backdated claim from another giver cannot displace a purchased claim, end to end', async () => {
    const clock = testClock()
    const net = network(clock)
    const { scarf, list, link } = await ownerWithList(net, clock)
    const sid = sharedItemIdFor(list, scarf.id)
    const honest = await openAsGiver(net, link, 'honest', clock)
    const { claim } = await honest.session.claim(sid)
    await honest.session.markPurchased(claim.id)
    // Mallory holds the link and publishes a claim dated at the epoch.
    const keys = deriveListKeys(list.listSecret)
    const evil: ClaimPayload = { v: 1, id: randomId(), itemId: sid, kind: 'full', status: 'reserved', createdAt: 0, updatedAt: 0 }
    // The event itself can only be backdated so far: an event older than its ~400-day lifetime is expired.
    const event = buildClaimEvent(evil, keys.claimsKey, { topic: keys.topic, secretKey: generateSigningKey(), createdAt: Math.floor(clock.now() / 1000) - 300 * DAY })
    expect((await honest.device.transport.publish(event)).ok).toBe(true)
    await waitFor(() => (honest.session.getSnapshot().items[0]?.state.rows.length ?? 0) === 2)
    const state = honest.session.getSnapshot().items[0]?.state
    expect(state?.status).toBe('purchased')
    expect(state?.rows.find((r) => r.mine)?.conflict).toBe(false)
    expect(state?.rows.find((r) => !r.mine)?.conflict).toBe(true)
  })

  it('dates a claim drafted offline when it first reaches a relay, and caches it before showing it', async () => {
    const clock = testClock()
    const net = network(clock)
    const { scarf, list, link } = await ownerWithList(net, clock)
    const g = await openAsGiver(net, link, 'g', clock)
    g.device.transport.offline = true
    const drafted = clock.now()
    const { claim, result } = await g.session.claim(sharedItemIdFor(list, scarf.id))
    expect(result.ok).toBe(false)
    const row = await g.device.db.events.get([g.guest.topic, claimSlot(g.guest.topic, claim.id)])
    expect(row).toMatchObject({ pending: true, unsent: true })

    clock.advance(3 * DAY * 1000)
    g.device.transport.offline = false
    await g.session.repair()
    const sent = g.session.getSnapshot().items[0]?.state.rows.find((r) => r.mine)
    expect(g.session.getSnapshot().pendingClaimIds).toEqual([])
    expect(sent?.createdAt).toBe(clock.now())
    expect(sent?.createdAt).toBeGreaterThan(drafted)
    const after = await g.device.db.events.get([g.guest.topic, claimSlot(g.guest.topic, claim.id)])
    expect(after?.pending).toBeUndefined()
    expect(after?.unsent).toBeUndefined()
  })

  it('ignores new claim slots beyond the per-list cap', () => {
    const { ctx, claim, sign } = setup()
    const limits = LIMITS as { claimsPerList: number }
    const saved = limits.claimsPerList
    limits.claimsPerList = 3
    try {
      const state = new ListState(ctx)
      const outcomes = [0, 1, 2, 3].map(() => state.ingest(sign(claim())).outcome)
      expect(outcomes).toEqual(['accepted', 'accepted', 'accepted', 'too-many'])
    } finally {
      limits.claimsPerList = saved
    }
  })
})

describe('metadata (finding 4)', () => {
  it('derives item ids per list: the same wish has unrelated ids in two lists and after rotation', async () => {
    const clock = testClock()
    const net = network(clock)
    const owner = testDevice(net, clock, 'owner')
    const wish = await createItem(owner.db, { title: 'Scarf' }, clock.now())
    const a = await createSharedList(owner, { name: 'A', itemIds: [wish.id] })
    const b = await createSharedList(owner, { name: 'B', itemIds: [wish.id] })
    await publishList(owner, a.id)
    await publishList(owner, b.id)
    const { list: a2 } = await rotateList(owner, a.id)
    const tags = net.store.all().flatMap((e) => e.tags.map((t) => t.join('=')))
    expect(tags.some((t) => t.includes(wish.id))).toBe(false)
    const ids = [sharedItemIdFor(a, wish.id), sharedItemIdFor(b, wish.id), sharedItemIdFor(a2, wish.id)]
    expect(new Set(ids).size).toBe(3)
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{32}$/)
    expect(localItemIdFor({ ...b }, ids[1] ?? '')).toBe(wish.id)
    // Item d-tags under different topics never share a suffix.
    const suffixes = net.store.all().map((e) => e.tags.find((t) => t[0] === 'd')?.[1]?.split(':').slice(2).join(':')).filter((s) => s?.startsWith('item:'))
    expect(new Set(suffixes).size).toBe(suffixes.length)
  })

  it('expiration tags do not reveal the event date', async () => {
    const clock = testClock()
    const net = network(clock)
    const { list } = await ownerWithList(net, clock)
    const meta = net.store.all().find((e) => e.tags.some((t) => t[0] === 'd' && t[1] === metaSlot(topicOfList(list))))
    const exp = meta ? expirationOf(meta) : undefined
    const created = meta?.created_at ?? 0
    const floor = expirationFor(created, 0)
    expect(exp).toBeGreaterThanOrEqual(floor)
    expect(exp).toBeLessThanOrEqual(floor + 30 * DAY)
    expect(new Date(floor * 1000).getUTCDate()).toBe(1)
    // Event date 2027-03-14 + 180 days would be 2027-09-10.
    expect(exp).not.toBe(Date.UTC(2027, 8, 10) / 1000)
  })

  it('drops movedTo from meta payloads (the field no longer exists)', () => {
    const m = parseListMetaPayload({ v: 1, name: 'x', itemIds: [], showPrices: true, showNotes: true, status: 'published', updatedAt: 1, movedTo: 'javascript:alert(1)' })
    expect(m).not.toHaveProperty('movedTo')
  })
})

describe('expiry (finding 5)', () => {
  it('a giver re-signs their own live claim when it is close to expiry, keeping its claim time', async () => {
    const clock = testClock()
    const net = network(clock)
    const { owner, scarf, list, link } = await ownerWithList(net, clock)
    const g = await openAsGiver(net, link, 'g', clock)
    const { claim } = await g.session.claim(sharedItemIdFor(list, scarf.id))
    const first = g.session.getSnapshot().items[0]?.state.rows[0]
    clock.advance(400 * DAY * 1000)
    await repairOwnerList(owner, list.id) // keep the list itself alive too
    await g.session.repair()
    const ev = net.store.all().find((e) => e.tags.some((t) => t[0] === 'd' && t[1] === claimSlot(g.guest.topic, claim.id)))
    expect(ev?.created_at).toBe(Math.floor(clock.now() / 1000))
    expect(g.session.getSnapshot().items[0]?.state.rows[0]?.createdAt).toBe(first?.createdAt)
  })

  it('re-signs own events close to expiry, so an unchanged list stays visible after 400 days', async () => {
    const clock = testClock()
    const net = network(clock)
    const { owner, scarf, list, link } = await ownerWithList(net, clock)
    clock.advance(400 * DAY * 1000) // within 60 days of the earliest possible expiry
    await updateSharedList(owner, list.id, { name: 'Birthday 2' })
    const r = await syncList(owner, list.id)
    expect(r.events.map((e) => e.kind).sort()).toEqual(['item', 'meta'])
    clock.advance(100 * DAY * 1000) // past the original items' expiry
    const g = await openAsGiver(net, link, 'g', clock)
    await waitFor(() => g.session.getSnapshot().items.length === 1)
    expect(g.session.getSnapshot().items[0]?.item.id).toBe(sharedItemIdFor(list, scarf.id))
  })

  it('repair re-signs near-expiry events of an unchanged list', async () => {
    const clock = testClock()
    const net = network(clock)
    const { owner, list } = await ownerWithList(net, clock)
    clock.advance(400 * DAY * 1000)
    const r = await repairOwnerList(owner, list.id)
    expect(r.events.map((e) => e.kind).sort()).toEqual(['item', 'meta'])
  })

  it('drops expired events on receive and from the giver cache', async () => {
    const clock = testClock()
    const net = network(clock)
    const { list, link } = await ownerWithList(net, clock)
    const g = await openAsGiver(net, link, 'g', clock)
    await waitFor(() => g.session.getSnapshot().items.length === 1)
    g.session.stop()
    const keys = deriveListKeys(list.listSecret)
    const expired = buildMetaEvent(
      { v: 1, name: 'x', itemIds: [], showPrices: true, showNotes: true, status: 'published', updatedAt: 1 },
      keys.contentKey,
      { topic: keys.topic, secretKey: list.ownerSecretKey, createdAt: 1000 },
    )
    expect(receiveEvent(expired, { ...keys, ownerPubkey: publicKeyOf(list.ownerSecretKey), now: clock.now })).toEqual({ ok: false, reason: 'expired' })
    clock.advance(500 * DAY * 1000)
    const again = await openGuestList(g.device, g.guest.topic, { eoseTimeoutMs: 100, retryMs: 50 })
    sessions.push(again)
    await again.start()
    expect(again.getSnapshot().meta).toBeNull()
    expect(await g.device.db.events.where('topic').equals(g.guest.topic).count()).toBe(0)
  })

  it('RelayStore refuses an expired event even when a copy is still stored', () => {
    let now = 100
    const store = new RelayStore(() => now)
    const e = { id: 'a'.repeat(64), pubkey: 'b'.repeat(64), sig: 'c'.repeat(128), kind: 30078, created_at: 50, content: '', tags: [['d', 'x'], ['expiration', '200']] }
    expect(store.add(e)).toBe('stored')
    now = 300
    expect(store.add(e)).toBe('expired')
    expect(store.all()).toEqual([])
  })
})

describe('relay URLs (findings 6 and 7)', () => {
  it('accepts only public wss:// relays in lists, links, settings and backups', () => {
    for (const ok of ['wss://relay.damus.io', 'wss://nos.lol:443/', 'wss://8.8.8.8', 'wss://[2001:4860::8888]', 'wss://relay.example.com/path']) {
      expect([ok, isRelayUrl(ok)]).toEqual([ok, true])
    }
    for (const bad of [
      'ws://relay.damus.io',
      'ws://127.0.0.1:7447',
      'wss://127.0.0.1',
      'wss://localhost',
      'wss://foo.localhost',
      'wss://10.1.2.3',
      'wss://172.16.0.1',
      'wss://192.168.0.10',
      'wss://169.254.169.254',
      'wss://100.64.0.1',
      'wss://0.0.0.0',
      'wss://0x7f000001',
      'wss://[::1]',
      'wss://[fe80::1]',
      'wss://[fd12::1]',
      'wss://[::ffff:127.0.0.1]',
      'wss://printer.local',
      'wss://nas.home.arpa',
      'wss://intranet',
      'wss://user:pw@relay.example.com',
      'wss://relay.example.com/#x',
      'https://relay.example.com',
    ]) {
      expect([bad, isRelayUrl(bad)]).toEqual([bad, false])
    }
  })

  it('allows ws:// and loopback only for the developer override', () => {
    expect(isLoopbackRelayUrl('ws://127.0.0.1:7447')).toBe(true)
    expect(isLoopbackRelayUrl('ws://localhost:7447')).toBe(true)
    expect(isLoopbackRelayUrl('wss://relay.damus.io')).toBe(false)
    expect(isLoopbackRelayUrl('ws://192.168.1.2:7447')).toBe(false)
  })
})

describe('hostile merge import (finding 8)', () => {
  it('never swaps keys, owner key or relays of lists already on the device', async () => {
    const clock = testClock()
    const net = network(clock)
    const { link } = await ownerWithList(net, clock, 'someone')
    const victim = testDevice(net, clock, 'victim')
    const mine = await createSharedList(victim, { name: 'Mine' })
    const guest = await addGuestListFromLink(victim, link)
    const file = JSON.parse(JSON.stringify(await exportData(victim.db))) as {
      sharedLists: Array<Record<string, unknown>>
      guestLists: Array<Record<string, unknown>>
    }
    const attackerKey = generateSigningKey()
    const evilShared = file.sharedLists[0]
    const evilGuest = file.guestLists[0]
    if (!evilShared || !evilGuest) throw new Error('fixture')
    evilShared.ownerSecretKey = attackerKey
    evilShared.listSecret = generateListSecret()
    evilShared.name = 'Hijacked'
    evilGuest.ownerPubkey = publicKeyOf(generateSigningKey())
    evilGuest.relays = ['wss://relay.evil.example']
    evilGuest.guestSecretKey = generateSigningKey()

    const r = await importData(victim.db, file)
    expect(r.skippedLists).toBe(2)
    expect(await victim.db.sharedLists.get(mine.id)).toEqual(mine)
    expect(await victim.db.guestLists.get(guest.topic)).toEqual(guest)
  })

  it('refuses a file that would make one of my lists a guest list (FR-25), on either side', async () => {
    const clock = testClock()
    const net = network(clock)
    const { owner, list, link } = await ownerWithList(net, clock)
    // A guest record for my own list, crafted into a file.
    const other = openDb(`hippo-test-${randomId()}`)
    const parsed = parseShareLink(link)
    await other.guestLists.put({
      topic: deriveListKeys(parsed.listSecret).topic,
      ownerPubkey: parsed.ownerPubkey,
      listSecret: parsed.listSecret,
      relays: [...list.relays],
      guestSecretKey: generateSigningKey(),
      addedAt: 1,
      lastOpenedAt: 1,
    })
    const hostile = JSON.parse(JSON.stringify(await exportData(other))) as unknown
    await expect(importData(owner.db, hostile)).rejects.toSatisfy((e: unknown) => isHippoError(e, 'invalid-import'))
    expect(await owner.db.guestLists.count()).toBe(0)

    // The other way round: importing a shared list that this device holds as a guest.
    const giver = testDevice(net, clock, 'giver')
    await addGuestListFromLink(giver, link)
    const ownerFile = JSON.parse(JSON.stringify(await exportData(owner.db))) as unknown
    await expect(importData(giver.db, ownerFile)).rejects.toSatisfy((e: unknown) => isHippoError(e, 'invalid-import'))
    expect(await giver.db.sharedLists.count()).toBe(0)
  })

  it('replace mode remembers dropped owned lists, so FR-25 still holds', async () => {
    const clock = testClock()
    const net = network(clock)
    const { owner, link } = await ownerWithList(net, clock)
    const empty = JSON.parse(JSON.stringify(await exportData(openDb(`hippo-test-${randomId()}`)))) as unknown
    await importData(owner.db, empty, { mode: 'replace' })
    expect(await owner.db.sharedLists.count()).toBe(0)
    await expect(addGuestListFromLink(owner, link)).rejects.toSatisfy((e: unknown) => isHippoError(e, 'own-list'))
  })

  it('exports and imports retired lists', async () => {
    const clock = testClock()
    const net = network(clock)
    const { owner, list, link } = await ownerWithList(net, clock)
    await rotateList(owner, list.id)
    const file = JSON.parse(JSON.stringify(await exportData(owner.db))) as unknown
    const restored = testDevice(net, clock, 'restored')
    await importData(restored.db, file)
    expect(await restored.db.retiredLists.count()).toBe(1)
    await expect(addGuestListFromLink(restored, link)).rejects.toSatisfy((e: unknown) => isHippoError(e, 'own-list'))
  })
})

describe('guest share link helper', () => {
  it('rebuilds the link of a list shared with me', async () => {
    const clock = testClock()
    const net = network(clock)
    const { link } = await ownerWithList(net, clock)
    const d = testDevice(net, clock, 'g')
    const g = await addGuestListFromLink(d, link)
    expect(buildGuestShareLink(g, BASE)).toBe(link)
    const custom = { ...g, relays: ['wss://relay.example.com'] }
    expect(parseShareLink(buildGuestShareLink(custom, BASE)).relays).toEqual(['wss://relay.example.com'])
  })
})
