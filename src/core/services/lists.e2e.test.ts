// @vitest-environment node
// Owner and givers on separate "devices" sharing one in-memory network.
import { afterEach, describe, expect, it } from 'vitest'
import { HIPPO_KIND } from '../protocol/slots.ts'
import { flush, testClock, testDevice, waitFor, type TestDevice } from '../testing/fixtures.ts'
import { MemoryNetwork } from '../transport/memory.ts'
import { isHippoError } from '../errors.ts'
import { publicKeyOf } from '../crypto/keys.ts'
import { addGuestListFromLink, listGuestLists, openGuestList, type GiverListSession } from './giver-lists.ts'
import {
  buildShareLink,
  createSharedList,
  publishList,
  repairOwnerList,
  rotateList,
  syncList,
  syncListsForItem,
  topicOfList,
  unpublishList,
  updateSharedList,
} from './owner-lists.ts'
import { archiveItem, createItem, updateItem } from './wishlist.ts'

const BASE = 'https://hippo.example/app/'
const sessions: GiverListSession[] = []

afterEach(() => {
  for (const s of sessions.splice(0)) s.stop()
})

async function ownerWithList(network: MemoryNetwork) {
  const clock = testClock()
  const owner = testDevice(network, clock, 'owner')
  const scarf = await createItem(owner.db, { title: 'Scarf', notes: 'Red please', price: { amount: 2500, currency: 'EUR' } }, clock.now())
  const bike = await createItem(owner.db, { title: 'Bike', price: { amount: 30000, currency: 'EUR' }, allowContributions: true }, clock.now())
  const socks = await createItem(owner.db, { title: 'Socks', quantity: 3 }, clock.now())
  const list = await createSharedList(owner, { name: 'Birthday', message: 'Thanks!', eventDate: '2026-12-24', itemIds: [scarf.id, bike.id, socks.id] })
  const report = await publishList(owner, list.id)
  expect(report.ok).toBe(true)
  return { owner, clock, list, scarf, bike, socks, link: buildShareLink(list, BASE) }
}

async function giver(network: MemoryNetwork, link: string, name: string, clock = testClock()) {
  const device = testDevice(network, clock, name)
  const guest = await addGuestListFromLink(device, link)
  const session = await openGuestList(device, guest.topic, { eoseTimeoutMs: 200, retryMs: 100 })
  sessions.push(session)
  await session.start()
  await waitFor(() => session.getSnapshot().status === 'live')
  return { device, session, view: () => session.getSnapshot() }
}

function itemView(session: GiverListSession, id: string) {
  const v = session.getSnapshot().items.find((i) => i.item.id === id)
  if (!v) throw new Error('item not in view')
  return v
}

function assertOwnerNeverSawClaims(owner: TestDevice, ownerPubkeys: string[]): void {
  expect(owner.transport.filterLog.length).toBeGreaterThan(0)
  for (const f of owner.transport.filterLog) {
    expect(f.authors).toBeDefined()
    expect(f.authors?.every((a) => ownerPubkeys.includes(a))).toBe(true)
  }
}

describe('shared lists end to end (MemoryTransport)', () => {
  it('owner publishes; two givers claim and pledge and see each other; owner sees no claims', async () => {
    const network = new MemoryNetwork()
    const { owner, list, scarf, bike, socks, link } = await ownerWithList(network)
    expect(link.startsWith(`${BASE}#/l/`)).toBe(true)

    const ann = await giver(network, link, 'ann')
    const ben = await giver(network, link, 'ben')
    const v = ann.view()
    expect(v.meta).toMatchObject({ name: 'Birthday', message: 'Thanks!', eventDate: '2026-12-24' })
    expect(v.items.map((i) => i.item.title)).toEqual(['Scarf', 'Bike', 'Socks'])
    expect(itemView(ann.session, scarf.id).item.notes).toBe('Red please')

    await ann.session.setNickname('Ann')
    await ann.session.claim(scarf.id)
    await ben.session.pledge(bike.id, 10000)
    await ben.session.claim(socks.id, 2)

    await waitFor(() => itemView(ben.session, scarf.id).state.status === 'claimed')
    await waitFor(() => itemView(ann.session, bike.id).state.pledged === 10000)
    await waitFor(() => itemView(ann.session, socks.id).state.grantedQuantity === 2)

    const scarfForBen = itemView(ben.session, scarf.id).state
    expect(scarfForBen.rows).toMatchObject([{ nickname: 'Ann', mine: false, conflict: false }])
    expect(itemView(ann.session, scarf.id).state.rows[0]?.mine).toBe(true)
    expect(itemView(ann.session, bike.id).state).toMatchObject({ status: 'partial', remainingAmount: 20000 })

    // Ben cannot claim the scarf outright any more; Ann covers the rest of the bike.
    await expect(ben.session.claim(scarf.id)).rejects.toSatisfy((e: unknown) => isHippoError(e, 'item-unavailable'))
    await expect(ann.session.claim(bike.id)).rejects.toSatisfy((e: unknown) => isHippoError(e, 'invalid-input'))
    await ann.session.coverTheRest(bike.id)
    await waitFor(() => itemView(ben.session, bike.id).state.status === 'funded')

    // Owner side: every read was restricted to the owner's key and no claim reached its cache.
    await syncList(owner, list.id)
    await repairOwnerList(owner, list.id)
    const ownerPubkey = publicKeyOf(list.ownerSecretKey)
    assertOwnerNeverSawClaims(owner, [ownerPubkey])
    const cached = await owner.db.events.toArray()
    expect(cached.every((r) => r.event.pubkey === ownerPubkey)).toBe(true)
    // And the network does hold claims, so the restriction is what kept them out.
    expect(network.store.all().some((e) => e.pubkey !== ownerPubkey)).toBe(true)
  })

  it('resolves simultaneous claims the same way for both givers (FR-23)', async () => {
    const network = new MemoryNetwork()
    const { scarf, link } = await ownerWithList(network)
    const ann = await giver(network, link, 'ann')
    const ben = await giver(network, link, 'ben')
    await Promise.all([ann.session.claim(scarf.id), ben.session.claim(scarf.id)])
    await waitFor(() => itemView(ann.session, scarf.id).state.rows.length === 2 && itemView(ben.session, scarf.id).state.rows.length === 2)
    const a = itemView(ann.session, scarf.id).state
    const b = itemView(ben.session, scarf.id).state
    expect(a.rows.map((r) => r.claimId)).toEqual(b.rows.map((r) => r.claimId))
    expect(a.rows.map((r) => r.conflict)).toEqual([false, true])
    // Exactly one of them sees a conflict on their own claim.
    const annConflict = a.rows.find((r) => r.mine)?.conflict
    const benConflict = b.rows.find((r) => r.mine)?.conflict
    expect([annConflict, benConflict].sort()).toEqual([false, true])
  })

  it('updates, purchases, withdraws and renames claims', async () => {
    const network = new MemoryNetwork()
    const { socks, bike, link } = await ownerWithList(network)
    const ann = await giver(network, link, 'ann')
    const ben = await giver(network, link, 'ben')
    const { claim } = await ann.session.claim(socks.id, 1)
    const pledge = await ann.session.pledge(bike.id, 500)
    await ann.session.updateClaim(claim.id, { quantity: 3 })
    await waitFor(() => itemView(ben.session, socks.id).state.status === 'claimed')
    await ann.session.markPurchased(claim.id)
    await waitFor(() => itemView(ben.session, socks.id).state.status === 'purchased')
    await ann.session.setNickname('Annie', { applyToExisting: true })
    await waitFor(() => itemView(ben.session, bike.id).state.rows[0]?.nickname === 'Annie')
    await ann.session.updateClaim(pledge.claim.id, { amount: 900 })
    await waitFor(() => itemView(ben.session, bike.id).state.pledged === 900)
    await ann.session.withdraw(claim.id)
    await waitFor(() => itemView(ben.session, socks.id).state.status === 'available')
    // Ben cannot touch Ann's claim.
    await expect(ben.session.withdraw(pledge.claim.id)).rejects.toSatisfy((e: unknown) => isHippoError(e, 'not-my-claim'))
    expect((await listGuestLists(ann.device.db))[0]).toMatchObject({ name: 'Birthday', nickname: 'Annie' })
  })

  it('propagates item edits, list settings and removals to givers', async () => {
    const network = new MemoryNetwork()
    const { owner, clock, list, scarf, bike, link } = await ownerWithList(network)
    const ann = await giver(network, link, 'ann')
    await ann.session.claim(scarf.id)

    clock.advance(5000)
    await updateItem(owner.db, bike.id, { title: 'Blue bike', price: { amount: 40000, currency: 'EUR' } }, clock.now())
    const reports = await syncListsForItem(owner, bike.id)
    expect(reports).toHaveLength(1)
    // Only the changed item was republished.
    expect(reports[0]?.events.map((e) => e.kind)).toEqual(['item'])
    await waitFor(() => itemView(ann.session, bike.id).item.title === 'Blue bike')

    await updateSharedList(owner, list.id, { showPrices: false, showNotes: false })
    await syncList(owner, list.id)
    await waitFor(() => itemView(ann.session, scarf.id).item.notes === undefined)
    expect(itemView(ann.session, bike.id).item.price).toBeUndefined()

    // Removing a claimed item: giver keeps the claim under "removed by owner"; owner gets no warning.
    await updateSharedList(owner, list.id, { itemIds: [bike.id] })
    await syncList(owner, list.id)
    await waitFor(() => ann.view().items.length === 1)
    expect(ann.view().removedItemsWithMyClaims).toMatchObject([{ itemId: scarf.id, item: { title: 'Scarf' } }])

    // Archiving hides an item too.
    await archiveItem(owner.db, bike.id, clock.now())
    await syncListsForItem(owner, bike.id)
    await waitFor(() => ann.view().items.length === 0)
  })

  it('unpublishes: givers see the list as no longer shared', async () => {
    const network = new MemoryNetwork()
    const { owner, list, scarf, link } = await ownerWithList(network)
    const ann = await giver(network, link, 'ann')
    await unpublishList(owner, list.id)
    await waitFor(() => ann.view().status === 'unpublished')
    expect(ann.view().items).toEqual([])
    await expect(ann.session.claim(scarf.id)).rejects.toSatisfy((e: unknown) => isHippoError(e, 'list-unpublished'))
    const topic = topicOfList(list)
    const ownerPubkey = publicKeyOf(list.ownerSecretKey)
    const tombstones = network.store.all().filter((e) => e.pubkey === ownerPubkey && e.content === '' && e.tags.some((t) => t[1] === topic))
    expect(tombstones).toHaveLength(3)
    // A newcomer with the old link sees it unpublished as well.
    const late = await testDevice(network, testClock(), 'late')
    const g = await addGuestListFromLink(late, link)
    const s = await openGuestList(late, g.topic, { eoseTimeoutMs: 200 })
    sessions.push(s)
    await s.start()
    await waitFor(() => s.getSnapshot().status === 'unpublished')
  })

  it('rotates: old link is cut off without a forwarding address; new link works; claims are not migrated', async () => {
    const network = new MemoryNetwork()
    const { owner, list, scarf, link } = await ownerWithList(network)
    const ann = await giver(network, link, 'ann')
    await ann.session.claim(scarf.id)
    const { list: rotated, published, unpublishedOld } = await rotateList(owner, list.id)
    expect(published.ok && unpublishedOld.ok).toBe(true)
    expect(rotated.listSecret).not.toBe(list.listSecret)
    expect(rotated.ownerSecretKey).not.toBe(list.ownerSecretKey)
    await waitFor(() => ann.view().status === 'unpublished')
    expect(ann.view().meta?.movedTo).toBeUndefined()
    const newLink = buildShareLink(rotated, BASE)
    expect(newLink).not.toBe(link)
    const ben = await giver(network, newLink, 'ben')
    expect(ben.view().items).toHaveLength(3)
    expect(itemView(ben.session, scarf.id).state.status).toBe('available')
    // Old topic cache is gone on the owner device.
    expect(await owner.db.events.where('topic').equals(topicOfList(list)).count()).toBe(0)
    await ben.session.claim(scarf.id)
    await repairOwnerList(owner, list.id)
    assertOwnerNeverSawClaims(owner, [publicKeyOf(list.ownerSecretKey), publicKeyOf(rotated.ownerSecretKey)])
  })

  it('refuses to open my own list as a giver (FR-25)', async () => {
    const network = new MemoryNetwork()
    const { owner, link } = await ownerWithList(network)
    await expect(addGuestListFromLink(owner, link)).rejects.toSatisfy((e: unknown) => isHippoError(e, 'own-list'))
    expect(await owner.db.guestLists.count()).toBe(0)
  })

  it('returns the same guest key when a link is opened twice', async () => {
    const network = new MemoryNetwork()
    const { link } = await ownerWithList(network)
    const d = testDevice(network, testClock(), 'ann')
    const a = await addGuestListFromLink(d, link)
    const b = await addGuestListFromLink(d, link)
    expect(b.guestSecretKey).toBe(a.guestSecretKey)
    await expect(addGuestListFromLink(d, 'https://hippo.example/#/l/AAAA')).rejects.toSatisfy((e: unknown) => isHippoError(e, 'invalid-link'))
  })

  it('works offline from cache, queues claims, and repairs when back', async () => {
    const network = new MemoryNetwork()
    const { scarf, link } = await ownerWithList(network)
    const ann = await giver(network, link, 'ann')
    ann.session.stop()

    // Reopen offline: cached list shows, status becomes offline.
    ann.device.transport.offline = true
    const s = await openGuestList(ann.device, ann.view().topic, { eoseTimeoutMs: 50, retryMs: 50 })
    sessions.push(s)
    await s.start()
    expect(s.getSnapshot().items).toHaveLength(3)
    await waitFor(() => s.getSnapshot().status === 'offline')
    const { claim, result } = await s.claim(scarf.id)
    expect(result.ok).toBe(false)
    await flush()
    expect(s.getSnapshot().pendingClaimIds).toEqual([claim.id])
    expect(network.store.all().some((e) => e.tags.some((t) => t[1]?.endsWith(claim.id)))).toBe(false)

    // Back online: the retry goes live and repair publishes the pending claim.
    ann.device.transport.offline = false
    await waitFor(() => s.getSnapshot().status === 'live')
    await waitFor(() => s.getSnapshot().pendingClaimIds.length === 0)
    expect(network.store.all().some((e) => e.tags.some((t) => t[1]?.endsWith(claim.id)))).toBe(true)
  })

  it('repairs events the relays dropped (owner republishes own events, giver republishes own claims)', async () => {
    const network = new MemoryNetwork()
    const { owner, list, scarf, link } = await ownerWithList(network)
    const ann = await giver(network, link, 'ann')
    const { claim } = await ann.session.claim(scarf.id)
    ann.session.stop()
    const ownerPubkey = publicKeyOf(list.ownerSecretKey)
    const before = network.store.all().filter((e) => e.kind === HIPPO_KIND)
    // The relay loses everything.
    network.store.clear()

    const report = await repairOwnerList(owner, list.id)
    expect(report.events.filter((e) => e.kind === 'republish')).toHaveLength(4)
    const restoredOwner = network.store.all()
    expect(restoredOwner.every((e) => e.pubkey === ownerPubkey)).toBe(true)
    // Unchanged, same signatures.
    expect(restoredOwner.map((e) => e.id).sort()).toEqual(before.filter((e) => e.pubkey === ownerPubkey).map((e) => e.id).sort())

    const s = await openGuestList(ann.device, ann.view().topic, { eoseTimeoutMs: 200 })
    sessions.push(s)
    await s.start()
    await waitFor(() => network.store.all().some((e) => e.tags.some((t) => t[1]?.endsWith(claim.id))))
  })

  it('a draft publishes nothing until published', async () => {
    const network = new MemoryNetwork()
    const owner = testDevice(network, testClock(), 'owner')
    const list = await createSharedList(owner, { name: 'Draft' })
    expect((await syncList(owner, list.id)).events).toEqual([])
    expect(network.store.all()).toEqual([])
  })
})
