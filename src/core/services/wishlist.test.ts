// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { openDb } from '../db/schema.ts'
import { randomId } from '../crypto/bytes.ts'
import { isHippoError } from '../errors.ts'
import { MemoryNetwork } from '../transport/memory.ts'
import { testDevice } from '../testing/fixtures.ts'
import { createSharedList, findListsContainingItem, publishList } from './owner-lists.ts'
import {
  archiveItem,
  createCategory,
  createItem,
  deleteCategory,
  deleteItem,
  filterAndSortItems,
  listCategories,
  listItems,
  reorderCategories,
  unarchiveItem,
  updateCategory,
  updateItem,
} from './wishlist.ts'

const db = () => openDb(`hippo-test-${randomId()}`)

describe('items', () => {
  it('creates items with defaults and validates input', async () => {
    const d = db()
    const item = await createItem(d, { title: '  Hippo  ', url: ' https://zoo.example/hippo ' }, 1000)
    expect(item).toMatchObject({ title: 'Hippo', url: 'https://zoo.example/hippo', quantity: 1, importance: 'want', allowContributions: false, categoryIds: [], createdAt: 1000 })
    await expect(createItem(d, { title: '   ' })).rejects.toSatisfy((e: unknown) => isHippoError(e, 'invalid-input'))
    await expect(createItem(d, { title: 'x', quantity: 0 })).rejects.toSatisfy((e: unknown) => isHippoError(e, 'invalid-input'))
    await expect(createItem(d, { title: 'x', price: { amount: 1.5, currency: 'EUR' } })).rejects.toThrow()
  })

  it('updates, clears optional fields and bumps updatedAt', async () => {
    const d = db()
    const item = await createItem(d, { title: 'A', notes: 'n', price: { amount: 100, currency: 'EUR' } }, 1000)
    const u = await updateItem(d, item.id, { notes: null, price: null, importance: 'love' }, 1000)
    expect(u.notes).toBeUndefined()
    expect(u.price).toBeUndefined()
    expect(u.importance).toBe('love')
    expect(u.updatedAt).toBe(1001)
    await expect(updateItem(d, randomId(), { title: 'x' })).rejects.toSatisfy((e: unknown) => isHippoError(e, 'not-found'))
  })

  it('archives and unarchives', async () => {
    const d = db()
    const item = await createItem(d, { title: 'A' })
    await archiveItem(d, item.id, 5)
    expect(await listItems(d)).toEqual([])
    expect(await listItems(d, { includeArchived: true })).toHaveLength(1)
    await unarchiveItem(d, item.id)
    expect(await listItems(d)).toHaveLength(1)
  })

  it('deleting an item unlinks it from shared lists', async () => {
    const device = testDevice(new MemoryNetwork())
    const a = await createItem(device.db, { title: 'A' })
    const b = await createItem(device.db, { title: 'B' })
    const list = await createSharedList(device, { name: 'L', itemIds: [a.id, b.id] })
    await publishList(device, list.id)
    expect((await findListsContainingItem(device.db, a.id)).map((l) => l.id)).toEqual([list.id])
    expect(await deleteItem(device.db, a.id)).toEqual([list.id])
    expect((await device.db.sharedLists.get(list.id))?.itemIds).toEqual([b.id])
  })

  it('filters and sorts', () => {
    const base = { quantity: 1, allowContributions: false, updatedAt: 0 }
    const items = [
      { ...base, id: '1', title: 'a', importance: 'nice' as const, categoryIds: ['c'], createdAt: 1, price: { amount: 500, currency: 'EUR' } },
      { ...base, id: '2', title: 'b', importance: 'love' as const, categoryIds: [], createdAt: 2 },
      { ...base, id: '3', title: 'c', importance: 'want' as const, categoryIds: ['c'], createdAt: 3, price: { amount: 100, currency: 'EUR' } },
    ]
    expect(filterAndSortItems(items).map((i) => i.id)).toEqual(['2', '3', '1'])
    expect(filterAndSortItems(items, { sort: 'newest' }).map((i) => i.id)).toEqual(['3', '2', '1'])
    expect(filterAndSortItems(items, { sort: 'price-asc' }).map((i) => i.id)).toEqual(['3', '1', '2'])
    expect(filterAndSortItems(items, { sort: 'price-desc' }).map((i) => i.id)).toEqual(['1', '3', '2'])
    expect(filterAndSortItems(items, { categoryId: 'c', importance: 'want' }).map((i) => i.id)).toEqual(['3'])
  })
})

describe('categories', () => {
  it('creates, renames, reorders and deletes categories; deleting keeps items', async () => {
    const d = db()
    const toys = await createCategory(d, 'Toys', '🧸')
    const books = await createCategory(d, 'Books')
    const games = await createCategory(d, 'Games')
    expect((await listCategories(d)).map((c) => c.name)).toEqual(['Toys', 'Books', 'Games'])
    await updateCategory(d, books.id, { name: 'Novels', emoji: '📚' })
    await updateCategory(d, toys.id, { emoji: null })
    await reorderCategories(d, [games.id, toys.id])
    const cats = await listCategories(d)
    expect(cats.map((c) => c.name)).toEqual(['Games', 'Toys', 'Novels'])
    expect(cats.map((c) => c.order)).toEqual([0, 1, 2])
    expect(cats[1]?.emoji).toBeUndefined()
    expect(cats[2]?.emoji).toBe('📚')

    const item = await createItem(d, { title: 'Lego', categoryIds: [toys.id, games.id] })
    await deleteCategory(d, toys.id)
    expect((await d.items.get(item.id))?.categoryIds).toEqual([games.id])
    expect(await listCategories(d)).toHaveLength(2)
    await expect(createCategory(d, '')).rejects.toSatisfy((e: unknown) => isHippoError(e, 'invalid-input'))
  })
})
