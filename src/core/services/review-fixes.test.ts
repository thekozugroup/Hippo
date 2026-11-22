// @vitest-environment node
// Hidden guest lists, closed contributions, owner sync tracking and
// tracking-parameter stripping.
import { afterEach, describe, expect, it } from 'vitest'
import { isHippoError } from '../errors.ts'
import { testClock, testDevice, waitFor } from '../testing/fixtures.ts'
import { MemoryNetwork } from '../transport/memory.ts'
import { exportData } from './backup.ts'
import { draftFromCapture, stripTrackingParams } from './capture.ts'
import { addGuestListFromLink, getGuestList, hideGuestList, listGuestLists, openGuestList, type GiverListSession } from './giver-lists.ts'
import {
  buildShareLink,
  createSharedList,
  getSharedList,
  hasPendingSync,
  publishList,
  retryPendingSync,
  rotateList,
  sharedItemIdFor,
  syncListsForItem,
  unpublishList,
} from './owner-lists.ts'
import { createItem, updateItem } from './wishlist.ts'

const BASE = 'https://hippo.example/app/'
const sessions: GiverListSession[] = []
afterEach(() => {
  for (const s of sessions.splice(0)) s.stop()
})

async function setup() {
  const network = new MemoryNetwork()
  const clock = testClock()
  const owner = testDevice(network, clock, 'owner')
  const bike = await createItem(owner.db, { title: 'Bike', price: { amount: 30000, currency: 'EUR' }, allowContributions: true }, clock.now())
  const lamp = await createItem(owner.db, { title: 'Lamp' }, clock.now())
  const list = await createSharedList(owner, { name: 'Birthday', itemIds: [bike.id, lamp.id] })
  await publishList(owner, list.id)
  return { network, clock, owner, bike, lamp, list, link: buildShareLink(list, BASE) }
}

async function open(device: ReturnType<typeof testDevice>, topic: string) {
  const s = await openGuestList(device, topic, { eoseTimeoutMs: 200, retryMs: 50 })
  sessions.push(s)
  await s.start()
  await waitFor(() => s.getSnapshot().status === 'live' && s.getSnapshot().meta !== null)
  return s
}

describe('hiding a list shared with me', () => {
  it('keeps the guest key, so reopening the link makes my claims mine again', async () => {
    const { network, clock, link, lamp, list } = await setup()
    const ann = testDevice(network, clock, 'ann')
    const guest = await addGuestListFromLink(ann, link)
    const s1 = await open(ann, guest.topic)
    await s1.setNickname('Ann')
    const lampId = sharedItemIdFor(list, lamp.id)
    const { claim } = await s1.claim(lampId)
    s1.stop()

    await hideGuestList(ann, guest.topic)
    expect(await listGuestLists(ann.db)).toEqual([])
    await expect(openGuestList(ann, guest.topic)).rejects.toSatisfy((e) => isHippoError(e, 'not-found'))
    const hidden = await getGuestList(ann.db, guest.topic)
    expect(hidden?.hiddenAt).toBeDefined()
    expect(hidden?.guestSecretKey).toBe(guest.guestSecretKey)
    // Backups still carry the key.
    expect((await exportData(ann.db)).guestLists.map((g) => g.guestSecretKey)).toEqual([guest.guestSecretKey])

    const again = await addGuestListFromLink(ann, link)
    expect(again.guestSecretKey).toBe(guest.guestSecretKey)
    expect(again.hiddenAt).toBeUndefined()
    expect(again.nickname).toBe('Ann')
    expect((await listGuestLists(ann.db)).length).toBe(1)
    const s2 = await open(ann, guest.topic)
    await waitFor(() => s2.getSnapshot().items.some((i) => i.state.rows.some((r) => r.mine)))
    const row = s2.getSnapshot().items.find((i) => i.item.id === lampId)?.state.rows[0]
    expect(row).toMatchObject({ mine: true, claimId: claim.id })
    await s2.withdraw(claim.id)
  })
})

describe('contributions switched off after pledges', () => {
  it('refuses new pledges and "cover the rest", allows lowering or taking back my pledge', async () => {
    const { network, clock, owner, link, bike, list } = await setup()
    const ann = testDevice(network, clock, 'ann')
    const s = await open(ann, (await addGuestListFromLink(ann, link)).topic)
    const bikeId = sharedItemIdFor(list, bike.id)
    const { claim } = await s.pledge(bikeId, 5000)

    await updateItem(owner.db, bike.id, { allowContributions: false })
    await syncListsForItem(owner, bike.id)
    await waitFor(() => s.getSnapshot().items.find((i) => i.item.id === bikeId)?.item.allowContributions === false)

    await expect(s.pledge(bikeId, 1000)).rejects.toSatisfy((e) => isHippoError(e, 'contributions-disabled'))
    await expect(s.coverTheRest(bikeId)).rejects.toSatisfy((e) => isHippoError(e, 'contributions-disabled'))
    await expect(s.updateClaim(claim.id, { amount: 9000 })).rejects.toSatisfy((e) => isHippoError(e, 'contributions-disabled'))
    await s.updateClaim(claim.id, { amount: 3000 })
    expect(s.getSnapshot().items.find((i) => i.item.id === bikeId)?.state.pledged).toBe(3000)
    await s.withdraw(claim.id)
    expect(s.getSnapshot().items.find((i) => i.item.id === bikeId)?.state.pledged).toBe(0)
  })
})

describe('titles of my claims after the owner stops sharing', () => {
  it('keeps the remembered title for removed items', async () => {
    const { network, clock, owner, link, lamp, list } = await setup()
    const ann = testDevice(network, clock, 'ann')
    const s = await open(ann, (await addGuestListFromLink(ann, link)).topic)
    await s.claim(sharedItemIdFor(list, lamp.id))
    await unpublishList(owner, list.id)
    await waitFor(() => s.getSnapshot().status === 'unpublished')
    await waitFor(() => s.getSnapshot().removedItemsWithMyClaims.length === 1)
    const removed = s.getSnapshot().removedItemsWithMyClaims[0]
    expect(removed?.item).toBeNull()
    expect(removed?.title).toBe('Lamp')
  })
})

describe('owner sync tracking', () => {
  it('a first publish no relay accepts leaves the link pending; a retry fixes it', async () => {
    const network = new MemoryNetwork()
    const clock = testClock()
    const owner = testDevice(network, clock, 'owner')
    const item = await createItem(owner.db, { title: 'Kite' })
    const list = await createSharedList(owner, { name: 'Kites', itemIds: [item.id] })
    owner.transport.offline = true
    const r = await publishList(owner, list.id)
    expect(r.ok).toBe(false)
    expect(await getSharedList(owner.db, list.id)).toMatchObject({ status: 'published', syncPending: true, linkPending: true })
    expect(await hasPendingSync(owner.db)).toBe(true)
    expect((await retryPendingSync(owner)).pending).toBe(true)

    owner.transport.offline = false
    expect((await retryPendingSync(owner)).pending).toBe(false)
    const after = await getSharedList(owner.db, list.id)
    expect(after?.syncPending).toBeUndefined()
    expect(after?.linkPending).toBeUndefined()
  })

  it('an item edit made offline reaches givers on the next retry, without opening the list', async () => {
    const { network, clock, owner, link, lamp, list } = await setup()
    owner.transport.offline = true
    await updateItem(owner.db, lamp.id, { title: 'Desk lamp' })
    expect((await getSharedList(owner.db, list.id))?.syncPending).toBe(true)
    await syncListsForItem(owner, lamp.id)
    expect((await getSharedList(owner.db, list.id))?.syncPending).toBe(true)
    expect((await getSharedList(owner.db, list.id))?.linkPending).toBeUndefined()

    owner.transport.offline = false
    expect((await retryPendingSync(owner)).pending).toBe(false)
    const ann = testDevice(network, clock, 'ann')
    const s = await open(ann, (await addGuestListFromLink(ann, link)).topic)
    await waitFor(() => s.getSnapshot().items.some((i) => i.item.title === 'Desk lamp'))
  })

  it('an unpublish no relay accepted is resent by the retry', async () => {
    const { owner, list } = await setup()
    owner.transport.offline = true
    await unpublishList(owner, list.id)
    expect((await getSharedList(owner.db, list.id))?.syncPending).toBe(true)
    owner.transport.offline = false
    expect((await retryPendingSync(owner)).pending).toBe(false)
  })

  it('a rotated link is pending until a relay has it', async () => {
    const { owner, list } = await setup()
    owner.transport.offline = true
    const r = await rotateList(owner, list.id)
    expect(r.list.linkPending).toBe(true)
    expect((await getSharedList(owner.db, list.id))?.linkPending).toBe(true)
    owner.transport.offline = false
    await retryPendingSync(owner)
    expect((await getSharedList(owner.db, list.id))?.linkPending).toBeUndefined()
    expect(await hasPendingSync(owner.db)).toBe(false)
  })
})

describe('tracking parameters', () => {
  it('removes campaign and click ids but keeps product parameters', () => {
    expect(stripTrackingParams('https://shop.example/p?id=42&utm_source=x&utm_medium=y&fbclid=abc&color=red')).toBe(
      'https://shop.example/p?id=42&color=red',
    )
    expect(stripTrackingParams('https://shop.example/p?gclid=1')).toBe('https://shop.example/p')
    expect(stripTrackingParams('https://shop.example/p?sku=9#:~:text=hello')).toBe('https://shop.example/p?sku=9')
    expect(stripTrackingParams('https://shop.example/p?ref=abc#reviews')).toBe('https://shop.example/p?ref=abc#reviews')
    expect(stripTrackingParams('not a url')).toBe('not a url')
  })

  it('is applied to captured links', () => {
    expect(draftFromCapture({ url: 'https://shop.example/lamp?variant=2&utm_campaign=xmas' }).url).toBe('https://shop.example/lamp?variant=2')
  })
})
