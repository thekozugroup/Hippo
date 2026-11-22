// Private wishlist: items and categories (PRD 4.1). Local only; callers
// republish affected shared lists via owner-lists `syncListsForItem`.

import { systemNow } from '../clock.ts'
import { randomId } from '../crypto/bytes.ts'
import type { HippoDb } from '../db/schema.ts'
import { HippoError } from '../errors.ts'
import { SchemaError, readOptionalString, readString } from '../model/guards.ts'
import { LIMITS } from '../model/limits.ts'
import type { Category, Importance, Item, Money } from '../model/types.ts'
import { IMPORTANCE_LEVELS } from '../model/types.ts'
import { readMoney } from '../model/validate.ts'

export interface ItemInput {
  title: string
  url?: string
  imageUrl?: string
  price?: Money
  quantity?: number
  importance?: Importance
  notes?: string
  categoryIds?: string[]
  allowContributions?: boolean
}

/** Fields that may be changed; `null` clears an optional field. */
export type ItemPatch = {
  [K in keyof ItemInput]?: K extends 'title' | 'quantity' | 'importance' | 'categoryIds' | 'allowContributions'
    ? ItemInput[K]
    : ItemInput[K] | null
}

function invalid(e: unknown): never {
  if (e instanceof SchemaError) throw new HippoError('invalid-input', e.message)
  throw e
}

function cleanOptional(value: string | null | undefined, path: string, max: number): string | undefined {
  if (value === null || value === undefined) return undefined
  const s = readOptionalString(value.trim(), path, max)
  return s === '' ? undefined : s
}

function applyFields(target: Item, input: ItemPatch): void {
  try {
    if (input.title !== undefined) target.title = readString(input.title.trim(), 'title', LIMITS.title, 1)
    if (input.url !== undefined) setOpt(target, 'url', cleanOptional(input.url, 'url', LIMITS.url))
    if (input.imageUrl !== undefined) setOpt(target, 'imageUrl', cleanOptional(input.imageUrl, 'imageUrl', LIMITS.url))
    if (input.notes !== undefined) setOpt(target, 'notes', cleanOptional(input.notes, 'notes', LIMITS.notes))
    if (input.price !== undefined) setOpt(target, 'price', input.price === null ? undefined : readMoney(input.price, 'price'))
    if (input.quantity !== undefined) {
      if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > LIMITS.quantity) {
        throw new SchemaError('quantity', `must be an integer 1..${LIMITS.quantity}`)
      }
      target.quantity = input.quantity
    }
    if (input.importance !== undefined) {
      if (!IMPORTANCE_LEVELS.includes(input.importance)) throw new SchemaError('importance', 'unknown level')
      target.importance = input.importance
    }
    if (input.categoryIds !== undefined) target.categoryIds = [...new Set(input.categoryIds)]
    if (input.allowContributions !== undefined) target.allowContributions = input.allowContributions
  } catch (e) {
    invalid(e)
  }
}

function setOpt<K extends 'url' | 'imageUrl' | 'notes' | 'price'>(target: Item, key: K, value: Item[K] | undefined): void {
  if (value === undefined) delete target[key]
  else target[key] = value
}

export async function createItem(db: HippoDb, input: ItemInput, now = systemNow()): Promise<Item> {
  const item: Item = {
    id: randomId(),
    title: '',
    quantity: 1,
    importance: 'want',
    categoryIds: [],
    allowContributions: false,
    createdAt: now,
    updatedAt: now,
  }
  applyFields(item, input)
  await db.items.add(item)
  return item
}

async function requireItem(db: HippoDb, id: string): Promise<Item> {
  const item = await db.items.get(id)
  if (!item) throw new HippoError('not-found', 'item not found')
  return item
}

/**
 * Flags every published list that links the item as needing a sync, in the
 * same transaction as the item change, so the change reaches givers even if
 * the app closes before `syncListsForItem` finishes (`retryPendingSync`).
 */
async function markListsWithItem(db: HippoDb, id: string): Promise<void> {
  await db.sharedLists
    .toCollection()
    .filter((l) => l.status === 'published' && l.itemIds.includes(id))
    .modify((l) => {
      l.syncPending = true
    })
}

export async function updateItem(db: HippoDb, id: string, patch: ItemPatch, now = systemNow()): Promise<Item> {
  return db.transaction('rw', db.items, db.sharedLists, async () => {
    const item = await requireItem(db, id)
    applyFields(item, patch)
    item.updatedAt = Math.max(now, item.updatedAt + 1)
    await db.items.put(item)
    await markListsWithItem(db, id)
    return item
  })
}

export interface MergeResult {
  item: Item
  /** Fields this edit set that had also been changed elsewhere since the form loaded (the edit's value was kept). */
  changedElsewhere: (keyof ItemPatch)[]
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/**
 * Saves only the fields an editor changed, merged onto the item as it is stored now, in one
 * transaction. `base` holds those fields as the editor loaded them: any that differ from the
 * stored item now were changed elsewhere in the meantime (another tab or window). The editor's
 * value wins, and they are reported so the person can be told.
 */
export async function mergeItemEdit(db: HippoDb, id: string, patch: ItemPatch, base: ItemPatch, now = systemNow()): Promise<MergeResult> {
  return db.transaction('rw', db.items, db.sharedLists, async () => {
    const item = await requireItem(db, id)
    const keys = Object.keys(patch) as (keyof ItemPatch)[]
    const changedElsewhere = keys.filter((k) => k in base && !sameValue(item[k], base[k]))
    if (keys.length > 0) {
      applyFields(item, patch)
      item.updatedAt = Math.max(now, item.updatedAt + 1)
      await db.items.put(item)
      await markListsWithItem(db, id)
    }
    return { item, changedElsewhere }
  })
}

/** Archived items stay in the wishlist but are left out of published lists. */
export async function archiveItem(db: HippoDb, id: string, now = systemNow()): Promise<Item> {
  return db.transaction('rw', db.items, db.sharedLists, async () => {
    const item = await requireItem(db, id)
    item.archivedAt = now
    item.updatedAt = Math.max(now, item.updatedAt + 1)
    await db.items.put(item)
    await markListsWithItem(db, id)
    return item
  })
}

export async function unarchiveItem(db: HippoDb, id: string, now = systemNow()): Promise<Item> {
  return db.transaction('rw', db.items, db.sharedLists, async () => {
    const item = await requireItem(db, id)
    delete item.archivedAt
    item.updatedAt = Math.max(now, item.updatedAt + 1)
    await db.items.put(item)
    await markListsWithItem(db, id)
    return item
  })
}

/** Deletes the item and unlinks it from every shared list. Returns the ids of lists that changed. */
export async function deleteItem(db: HippoDb, id: string, now = systemNow()): Promise<string[]> {
  return db.transaction('rw', db.items, db.sharedLists, async () => {
    await db.items.delete(id)
    const changed: string[] = []
    await db.sharedLists.toCollection().modify((list) => {
      if (list.itemIds.includes(id)) {
        list.itemIds = list.itemIds.filter((x) => x !== id)
        list.updatedAt = Math.max(now, list.updatedAt + 1)
        if (list.status === 'published') list.syncPending = true
        changed.push(list.id)
      }
    })
    return changed
  })
}

export async function getItem(db: HippoDb, id: string): Promise<Item | undefined> {
  return db.items.get(id)
}

export async function listItems(db: HippoDb, options: { includeArchived?: boolean } = {}): Promise<Item[]> {
  const all = await db.items.toArray()
  return options.includeArchived ? all : all.filter((i) => i.archivedAt === undefined)
}

// ---- Filtering and sorting (FR-4), pure ----

export type ItemSort = 'importance' | 'newest' | 'oldest' | 'price-asc' | 'price-desc'

export interface ItemQuery {
  categoryId?: string
  importance?: Importance
  sort?: ItemSort
}

const IMPORTANCE_RANK: Record<Importance, number> = { love: 0, want: 1, nice: 2 }

export function filterAndSortItems(items: readonly Item[], q: ItemQuery = {}): Item[] {
  const out = items.filter(
    (i) =>
      (q.categoryId === undefined || i.categoryIds.includes(q.categoryId)) &&
      (q.importance === undefined || i.importance === q.importance),
  )
  const byNewest = (a: Item, b: Item): number => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1)
  // Items without a price sort last in both price directions.
  const price = (i: Item, dir: 1 | -1): number => (i.price ? i.price.amount * dir : Number.POSITIVE_INFINITY)
  const sorters: Record<ItemSort, (a: Item, b: Item) => number> = {
    importance: (a, b) => IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance] || byNewest(a, b),
    newest: byNewest,
    oldest: (a, b) => -byNewest(a, b),
    'price-asc': (a, b) => price(a, 1) - price(b, 1) || byNewest(a, b),
    'price-desc': (a, b) => price(a, -1) - price(b, -1) || byNewest(a, b),
  }
  return out.sort(sorters[q.sort ?? 'importance'])
}

// ---- Categories (FR-3) ----

function readCategoryName(name: string): string {
  try {
    return readString(name.trim(), 'name', LIMITS.categoryName, 1)
  } catch (e) {
    invalid(e)
  }
}

export async function listCategories(db: HippoDb): Promise<Category[]> {
  return db.categories.orderBy('order').toArray()
}

export async function createCategory(db: HippoDb, name: string, emoji?: string): Promise<Category> {
  return db.transaction('rw', db.categories, async () => {
    const last = await db.categories.orderBy('order').last()
    const category: Category = { id: randomId(), name: readCategoryName(name), order: (last?.order ?? -1) + 1 }
    const e = cleanOptional(emoji, 'emoji', LIMITS.emoji)
    if (e) category.emoji = e
    await db.categories.add(category)
    return category
  })
}

export async function updateCategory(
  db: HippoDb,
  id: string,
  patch: { name?: string; emoji?: string | null },
): Promise<Category> {
  return db.transaction('rw', db.categories, async () => {
    const c = await db.categories.get(id)
    if (!c) throw new HippoError('not-found', 'category not found')
    if (patch.name !== undefined) c.name = readCategoryName(patch.name)
    if (patch.emoji !== undefined) {
      let e: string | undefined
      try {
        e = cleanOptional(patch.emoji, 'emoji', LIMITS.emoji)
      } catch (err) {
        invalid(err)
      }
      if (e) c.emoji = e
      else delete c.emoji
    }
    await db.categories.put(c)
    return c
  })
}

/** `orderedIds` lists categories in their new order; any not listed keep their relative order after them. */
export async function reorderCategories(db: HippoDb, orderedIds: readonly string[]): Promise<Category[]> {
  return db.transaction('rw', db.categories, async () => {
    const all = await db.categories.orderBy('order').toArray()
    const rank = new Map(orderedIds.map((id, i) => [id, i]))
    const sorted = [...all].sort((a, b) => {
      const ra = rank.get(a.id) ?? orderedIds.length + a.order
      const rb = rank.get(b.id) ?? orderedIds.length + b.order
      return ra - rb
    })
    sorted.forEach((c, i) => (c.order = i))
    await db.categories.bulkPut(sorted)
    return sorted
  })
}

/** Deletes the category and removes its id from every item; items themselves stay. */
export async function deleteCategory(db: HippoDb, id: string): Promise<void> {
  await db.transaction('rw', db.categories, db.items, async () => {
    await db.categories.delete(id)
    await db.items
      .where('categoryIds')
      .equals(id)
      .modify((item) => {
        item.categoryIds = item.categoryIds.filter((c) => c !== id)
      })
  })
}
