// Writing setup progress and what setup creates. Each write runs in one
// database transaction keyed on the stored progress, so setup open in two
// tabs (or a double press) creates one list and one wish, never two.

import { createItem, createSharedList, getItem, getSettings, getSharedList, setOnboarding, updateItem, updateSharedList, type Core, type HippoDb } from '../../../core/index.ts'
import { toStored, type Flow } from '../../core/onboarding.ts'
import type { WishDraft } from './flow.ts'

/**
 * Saves the flow's progress. A list or wish another tab already created is kept: an id the
 * stored progress has and this tab does not know yet is never dropped.
 */
export async function persistFlow(db: HippoDb, f: Flow, now: number): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const stored = (await getSettings(db)).onboarding
    const listId = f.listId ?? stored?.listId
    const itemId = f.itemId ?? stored?.itemId
    await setOnboarding(db, toStored({ ...f, ...(listId ? { listId } : {}), ...(itemId ? { itemId } : {}) }, now))
  })
}

/** The setup list: updated when setup made one already (in this tab or another), else created. Returns its id. */
export async function ensureSetupList(core: Core, f: Flow, fields: { name: string; eventDate: string }): Promise<string> {
  const { db } = core
  return db.transaction('rw', [db.sharedLists, db.settings], async () => {
    const stored = (await getSettings(db)).onboarding
    for (const id of [f.listId, stored?.listId]) {
      if (id && (await getSharedList(db, id))) {
        await updateSharedList(core, id, { name: fields.name, eventDate: fields.eventDate || null })
        await setOnboarding(db, toStored({ ...f, listId: id, ...(stored?.itemId && !f.itemId ? { itemId: stored.itemId } : {}) }, core.now()))
        return id
      }
    }
    const list = await createSharedList(core, { name: fields.name, ...(fields.eventDate ? { eventDate: fields.eventDate } : {}) })
    await setOnboarding(db, toStored({ ...f, listId: list.id, ...(stored?.itemId && !f.itemId ? { itemId: stored.itemId } : {}) }, core.now()))
    return list.id
  })
}

/** The setup wish, likewise; it is also put on the setup list. */
export async function ensureSetupWish(core: Core, f: Flow, draft: WishDraft): Promise<{ itemId: string; created: boolean }> {
  const { db } = core
  return db.transaction('rw', [db.items, db.sharedLists, db.settings], async () => {
    const stored = (await getSettings(db)).onboarding
    const listId = f.listId ?? stored?.listId
    let itemId: string | undefined
    let created = false
    for (const id of [f.itemId, stored?.itemId]) {
      if (id && (await getItem(db, id))) {
        await updateItem(db, id, { title: draft.title, url: draft.url ?? null }, core.now())
        itemId = id
        break
      }
    }
    if (!itemId) {
      itemId = (await createItem(db, { title: draft.title, ...(draft.url ? { url: draft.url } : {}) }, core.now())).id
      created = true
    }
    await setOnboarding(db, toStored({ ...f, itemId, ...(listId ? { listId } : {}) }, core.now()))
    const list = listId ? await getSharedList(db, listId) : undefined
    if (list && !list.itemIds.includes(itemId)) await updateSharedList(core, list.id, { itemIds: [...list.itemIds, itemId] })
    return { itemId, created }
  })
}
