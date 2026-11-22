// @vitest-environment node
// The owner's display name (settings) and its trip to givers in the list meta,
// plus the first-run settings (onboarding progress, one-time hints).
import { afterEach, describe, expect, it } from 'vitest'
import { getSettings, markSeen, setOnboarding, setOwnerName } from '../db/settings.ts'
import { parseListMetaPayload } from '../model/validate.ts'
import { testClock, testDevice, waitFor } from '../testing/fixtures.ts'
import { MemoryNetwork } from '../transport/memory.ts'
import { addGuestListFromLink, openGuestList, type GiverListSession } from './giver-lists.ts'
import { buildShareLink, createSharedList, metaPayloadFor, publishList, syncList } from './owner-lists.ts'
import { createItem } from './wishlist.ts'

const BASE = 'https://hippo.example/app/'
const sessions: GiverListSession[] = []
afterEach(() => {
  for (const s of sessions.splice(0)) s.stop()
})

const META = { v: 1, name: 'Birthday', itemIds: [], showPrices: true, showNotes: true, status: 'published', updatedAt: 1 }

describe('ownerName in the list meta', () => {
  it('is optional, kept when valid and limited to 40 characters', () => {
    expect(parseListMetaPayload(META).ownerName).toBeUndefined()
    expect(parseListMetaPayload({ ...META, ownerName: 'Ann' }).ownerName).toBe('Ann')
    expect(parseListMetaPayload({ ...META, ownerName: '🦛'.repeat(40) }).ownerName).toBe('🦛'.repeat(40))
    expect(() => parseListMetaPayload({ ...META, ownerName: 'a'.repeat(41) })).toThrow(/ownerName/)
    expect(() => parseListMetaPayload({ ...META, ownerName: 42 })).toThrow(/ownerName/)
  })

  it('is added by the builder only when set', () => {
    const list = { name: 'X', itemIds: [], showPrices: true, showNotes: true, updatedAt: 5 } as unknown as Parameters<typeof metaPayloadFor>[0]
    expect(metaPayloadFor(list, [])).not.toHaveProperty('ownerName')
    expect(metaPayloadFor(list, [], 'Ann').ownerName).toBe('Ann')
  })

  it('reaches givers, and a later name change is republished', async () => {
    const network = new MemoryNetwork()
    const clock = testClock()
    const owner = testDevice(network, clock, 'owner')
    await setOwnerName(owner.db, '  Ann   Lee ')
    const item = await createItem(owner.db, { title: 'Scarf' }, clock.now())
    const list = await createSharedList(owner, { name: 'Birthday', itemIds: [item.id] })
    expect((await publishList(owner, list.id)).ok).toBe(true)

    const device = testDevice(network, clock, 'giver')
    const guest = await addGuestListFromLink(device, buildShareLink(list, BASE))
    const session = await openGuestList(device, guest.topic, { eoseTimeoutMs: 200, retryMs: 100 })
    sessions.push(session)
    await session.start()
    await waitFor(() => session.getSnapshot().status === 'live')
    expect(session.getSnapshot().meta?.ownerName).toBe('Ann Lee')

    await setOwnerName(owner.db, 'Annie')
    clock.advance(1000)
    await syncList(owner, list.id)
    await waitFor(() => session.getSnapshot().meta?.ownerName === 'Annie')

    await setOwnerName(owner.db, undefined)
    clock.advance(1000)
    await syncList(owner, list.id)
    await waitFor(() => session.getSnapshot().meta !== null && session.getSnapshot().meta?.ownerName === undefined)
  })
})

describe('first-run settings', () => {
  it('stores a cleaned owner name and rejects one that is too long', async () => {
    const { db } = testDevice(new MemoryNetwork(), testClock(), 'a')
    expect(await setOwnerName(db, ' Sam ')).toBe('Sam')
    expect((await getSettings(db)).ownerName).toBe('Sam')
    await expect(setOwnerName(db, 'x'.repeat(41))).rejects.toThrow(RangeError)
    expect(await setOwnerName(db, '   ')).toBeUndefined()
    expect((await getSettings(db)).ownerName).toBeUndefined()
  })

  it('round-trips onboarding progress and drops bad values on read', async () => {
    const { db } = testDevice(new MemoryNetwork(), testClock(), 'b')
    expect((await getSettings(db)).onboarding).toBeUndefined()
    await setOnboarding(db, { status: 'active', step: 2, answers: { name: 'Ann', occasion: 'birthday' }, listId: 'abc_123', updatedAt: 10 })
    expect((await getSettings(db)).onboarding).toEqual({ status: 'active', step: 2, answers: { name: 'Ann', occasion: 'birthday' }, listId: 'abc_123', updatedAt: 10 })
    await expect(setOnboarding(db, { status: 'active', step: 99, answers: {}, updatedAt: 1 })).rejects.toThrow()
    // Hand-edited or stale rows are ignored or trimmed, never trusted.
    await db.settings.put({ key: 'onboarding', value: { status: 'active', step: 1, answers: { name: 'x'.repeat(301), ok: 'y', 'bad key': 'z' }, listId: '../x', updatedAt: 3 } })
    expect((await getSettings(db)).onboarding).toEqual({ status: 'active', step: 1, answers: { ok: 'y' }, updatedAt: 3 })
    await db.settings.put({ key: 'onboarding', value: { status: 'weird', step: 1, answers: {}, updatedAt: 3 } })
    expect((await getSettings(db)).onboarding).toBeUndefined()
    await setOnboarding(db, undefined)
    expect((await getSettings(db)).onboarding).toBeUndefined()
  })

  it('remembers one-time hints per flag', async () => {
    const { db } = testDevice(new MemoryNetwork(), testClock(), 'c')
    expect((await getSettings(db)).seen).toEqual({})
    await markSeen(db, 'giverIntro', 5)
    await markSeen(db, 'setupChecklist', 6)
    expect((await getSettings(db)).seen).toEqual({ giverIntro: 5, setupChecklist: 6 })
    await markSeen(db, 'linkPreviewHint', 7)
    expect((await getSettings(db)).seen).toEqual({ giverIntro: 5, setupChecklist: 6, linkPreviewHint: 7 })
  })
})
