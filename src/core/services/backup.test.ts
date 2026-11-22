// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { openDb } from '../db/schema.ts'
import { getSettings, setRelayOverride, setTheme } from '../db/settings.ts'
import { randomId } from '../crypto/bytes.ts'
import { isHippoError } from '../errors.ts'
import { MemoryNetwork } from '../transport/memory.ts'
import { testDevice } from '../testing/fixtures.ts'
import { exportData, importData, parseExportFile } from './backup.ts'
import { addGuestListFromLink } from './giver-lists.ts'
import { buildShareLink, createSharedList, publishList } from './owner-lists.ts'
import { createCategory, createItem } from './wishlist.ts'

async function populated() {
  const network = new MemoryNetwork()
  const owner = testDevice(network, undefined, 'owner')
  const cat = await createCategory(owner.db, 'Toys', '🧸')
  const item = await createItem(owner.db, { title: 'Hippo', categoryIds: [cat.id], price: { amount: 999, currency: 'EUR' }, notes: 'big' })
  const list = await createSharedList(owner, { name: 'Xmas', itemIds: [item.id], eventDate: '2026-12-24' })
  await publishList(owner, list.id)
  // A list someone else shared with this device.
  const other = testDevice(network, undefined, 'other')
  const otherList = await createSharedList(other, { name: 'Theirs' })
  await publishList(other, otherList.id)
  await addGuestListFromLink(owner, buildShareLink(otherList, 'https://h.example/'))
  await setTheme(owner.db, 'dark')
  await setRelayOverride(owner.db, ['wss://relay.example.com'])
  return owner
}

describe('export / import', () => {
  it('round trips everything, including secrets, through JSON', async () => {
    const source = await populated()
    const file = await exportData(source.db, 12345)
    expect((await getSettings(source.db)).lastExportAt).toBe(12345)
    const json = JSON.parse(JSON.stringify(file)) as unknown

    const target = openDb(`hippo-test-${randomId()}`)
    const result = await importData(target, json)
    expect(result).toEqual({ items: 1, categories: 1, sharedLists: 1, guestLists: 1, skippedLists: 0 })
    expect(await target.items.toArray()).toEqual(await source.db.items.toArray())
    expect(await target.categories.toArray()).toEqual(await source.db.categories.toArray())
    expect(await target.sharedLists.toArray()).toEqual(await source.db.sharedLists.toArray())
    expect(await target.guestLists.toArray()).toEqual(await source.db.guestLists.toArray())
    const [list] = await target.sharedLists.toArray()
    expect(list?.ownerSecretKey).toMatch(/^[0-9a-f]{64}$/)
    expect(list?.listSecret).toMatch(/^[0-9a-f]{64}$/)
    expect((await target.guestLists.toArray())[0]?.guestSecretKey).toMatch(/^[0-9a-f]{64}$/)
    expect(await getSettings(target)).toMatchObject({ theme: 'dark', relays: ['wss://relay.example.com'] })
  })

  it('replace mode clears existing data first', async () => {
    const source = await populated()
    const file = JSON.parse(JSON.stringify(await exportData(source.db))) as unknown
    const target = openDb(`hippo-test-${randomId()}`)
    await createItem(target, { title: 'Local only' })
    await importData(target, file, { mode: 'replace' })
    expect((await target.items.toArray()).map((i) => i.title)).toEqual(['Hippo'])
  })

  it('rejects unknown formats and versions', () => {
    expect(() => parseExportFile({ format: 'other', version: 1 })).toThrow()
    try {
      parseExportFile({ format: 'hippo-export', version: 2 })
    } catch (e) {
      expect(isHippoError(e, 'unsupported-version')).toBe(true)
    }
    expect(() => parseExportFile(null)).toThrow()
  })

  it('rejects the whole file when any record is malformed, with a path', async () => {
    const source = await populated()
    type Rec = Record<string, unknown>
    const good = JSON.parse(JSON.stringify(await exportData(source.db))) as Record<string, Rec[]>
    const rec = (f: Record<string, Rec[]>, key: string): Rec => {
      const r = f[key]?.[0]
      if (!r) throw new Error(`fixture has no ${key}`)
      return r
    }
    const variants: Array<(f: Record<string, Rec[]>) => void> = [
      (f) => delete rec(f, 'sharedLists').ownerSecretKey,
      (f) => (rec(f, 'guestLists').guestSecretKey = 'short'),
      (f) => (rec(f, 'items').title = ''),
      (f) => (rec(f, 'sharedLists').relays = ['http://evil.example']),
      (f) => (rec(f, 'sharedLists').relays = ['wss://10.0.0.1']),
      (f) => (rec(f, 'sharedLists').ownerSecretKey = 'f'.repeat(64)), // >= curve order: not a valid key
      (f) => (rec(f, 'guestLists').ownerPubkey = '0'.repeat(64)), // not on the curve
      (f) => (rec(f, 'guestLists').topic = 'ab'.repeat(32)), // does not match the list secret
      (f) => f.items?.push(rec(f, 'items')),
    ]
    for (const mutate of variants) {
      const f = structuredClone(good)
      mutate(f)
      let error: unknown
      try {
        parseExportFile(f)
      } catch (e) {
        error = e
      }
      expect(isHippoError(error, 'invalid-import')).toBe(true)
    }
    const target = openDb(`hippo-test-${randomId()}`)
    const bad = structuredClone(good)
    delete rec(bad, 'sharedLists').listSecret
    await expect(importData(target, bad)).rejects.toThrow(/sharedLists\[0\]\.listSecret/)
    expect(await target.items.count()).toBe(0)
  })
})
