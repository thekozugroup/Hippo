// Shared lists I own (PRD 4.3, PROTOCOL.md sections 4, 8, 9). All network
// access goes through OwnerChannel, which only ever asks for the owner's own
// events; owner code never derives the claims key.

import { DEFAULT_RELAYS } from '../config.ts'
import { decryptJson } from '../crypto/aead.ts'
import { randomId } from '../crypto/bytes.ts'
import {
  deriveContentKeys,
  generateListSecret,
  generateSigningKey,
  publicKeyOf,
  sharedItemIdWith,
  topicForSecret,
} from '../crypto/keys.ts'
import { shareLinkFor } from '../crypto/link.ts'
import { cacheIfNewer, deleteCachedTopic, getCachedEvents } from '../db/event-cache.ts'
import type { CachedEvent, HippoDb } from '../db/schema.ts'
import { getSettings } from '../db/settings.ts'
import { HippoError } from '../errors.ts'
import { SchemaError, readOptionalDate, readOptionalString, readString } from '../model/guards.ts'
import { LIMITS } from '../model/limits.ts'
import type { Item, ItemPayload, ListMetaPayload, RetiredList, SharedList } from '../model/types.ts'
import { parseListMetaPayload, tryParse } from '../model/validate.ts'
import {
  buildItemEvent,
  buildItemTombstone,
  buildMetaEvent,
  expiresSoon,
  isExpired,
  nextCreatedAt,
  type SignOptions,
} from '../protocol/build.ts'
import { itemSlot, metaSlot, parseSlot } from '../protocol/slots.ts'
import type { NostrEvent, PublishResult } from '../transport/types.ts'
import type { CoreDeps } from './deps.ts'
import { OwnerChannel } from './owner-channel.ts'
import { serialize, stableStringify } from './util.ts'

export interface SharedListInput {
  name: string
  message?: string
  eventDate?: string
  itemIds?: string[]
  showPrices?: boolean
  showNotes?: boolean
}

export type SharedListPatch = {
  name?: string
  message?: string | null
  eventDate?: string | null
  itemIds?: string[]
  showPrices?: boolean
  showNotes?: boolean
}

export interface PublishedEventReport {
  d: string
  kind: 'meta' | 'item' | 'tombstone' | 'republish'
  result: PublishResult
}

export interface SyncReport {
  listId: string
  /** False when any event was accepted by no relay; those are retried by the next sync or repair. */
  ok: boolean
  events: PublishedEventReport[]
}

// ---- Local CRUD ----

function invalidInput(e: unknown): never {
  if (e instanceof SchemaError) throw new HippoError('invalid-input', e.message)
  throw e
}

function applyListPatch(list: SharedList, patch: SharedListPatch): void {
  try {
    if (patch.name !== undefined) list.name = readString(patch.name.trim(), 'name', LIMITS.name, 1)
    if (patch.message !== undefined) {
      const m = patch.message === null ? undefined : readOptionalString(patch.message.trim(), 'message', LIMITS.message)
      if (m) list.message = m
      else delete list.message
    }
    if (patch.eventDate !== undefined) {
      const d = patch.eventDate === null || patch.eventDate === '' ? undefined : readOptionalDate(patch.eventDate, 'eventDate')
      if (d) list.eventDate = d
      else delete list.eventDate
    }
    if (patch.itemIds !== undefined) {
      const ids = [...new Set(patch.itemIds)]
      if (ids.length > LIMITS.itemIds) throw new SchemaError('itemIds', `more than ${LIMITS.itemIds} items`)
      list.itemIds = ids
    }
    if (patch.showPrices !== undefined) list.showPrices = patch.showPrices
    if (patch.showNotes !== undefined) list.showNotes = patch.showNotes
  } catch (e) {
    invalidInput(e)
  }
}

/** Relays for new lists: the settings override, else the protocol defaults. */
export async function relaysForNewList(db: HippoDb): Promise<string[]> {
  const s = await getSettings(db)
  return s.relays ?? [...DEFAULT_RELAYS]
}

export async function createSharedList(deps: CoreDeps, input: SharedListInput): Promise<SharedList> {
  const now = deps.now()
  const list: SharedList = {
    id: randomId(),
    name: '',
    itemIds: [],
    showPrices: true,
    showNotes: true,
    ownerSecretKey: generateSigningKey(),
    listSecret: generateListSecret(),
    relays: await relaysForNewList(deps.db),
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  }
  applyListPatch(list, input)
  await deps.db.sharedLists.add(list)
  return list
}

async function requireList(db: HippoDb, id: string): Promise<SharedList> {
  const list = await db.sharedLists.get(id)
  if (!list) throw new HippoError('not-found', 'shared list not found')
  return list
}

/** Changes the list locally. Call `syncList` afterwards to republish a published list. */
export async function updateSharedList(deps: CoreDeps, id: string, patch: SharedListPatch): Promise<SharedList> {
  return deps.db.transaction('rw', deps.db.sharedLists, async () => {
    const list = await requireList(deps.db, id)
    applyListPatch(list, patch)
    list.updatedAt = Math.max(deps.now(), list.updatedAt + 1)
    if (list.status === 'published') list.syncPending = true
    await deps.db.sharedLists.put(list)
    return list
  })
}

export async function getSharedList(db: HippoDb, id: string): Promise<SharedList | undefined> {
  return db.sharedLists.get(id)
}

export async function listSharedLists(db: HippoDb): Promise<SharedList[]> {
  const all = await db.sharedLists.toArray()
  return all.sort((a, b) => b.createdAt - a.createdAt)
}

/** Published lists that link the item; these need `syncList` after the item changes. */
export async function findListsContainingItem(db: HippoDb, itemId: string): Promise<SharedList[]> {
  const all = await db.sharedLists.toArray()
  return all.filter((l) => l.status === 'published' && l.itemIds.includes(itemId))
}

// ---- Shared item ids ----

/** The id a local wishlist item has inside this list's shared space (PROTOCOL.md section 2). */
export function sharedItemIdFor(list: Pick<SharedList, 'listSecret'>, localItemId: string): string {
  return sharedItemIdWith(deriveContentKeys(list.listSecret).slotKey, localItemId)
}

/** Maps a shared item id back to the local wishlist item id; `undefined` if the list does not link it. */
export function localItemIdFor(list: Pick<SharedList, 'listSecret' | 'itemIds'>, sharedId: string): string | undefined {
  const { slotKey } = deriveContentKeys(list.listSecret)
  return list.itemIds.find((id) => sharedItemIdWith(slotKey, id) === sharedId)
}

// ---- Payloads ----

/** `sharedId` is the item's id in this list (see `sharedItemIdFor`); the local id never leaves the device. */
export function itemPayloadFor(item: Item, list: Pick<SharedList, 'showPrices' | 'showNotes'>, sharedId: string): ItemPayload {
  const p: ItemPayload = {
    v: 1,
    id: sharedId,
    title: item.title,
    quantity: item.quantity,
    importance: item.importance,
    allowContributions: item.allowContributions,
    updatedAt: item.updatedAt,
  }
  if (item.url) p.url = item.url
  if (item.imageUrl) p.imageUrl = item.imageUrl
  if (item.price && list.showPrices) p.price = { ...item.price }
  if (item.notes && list.showNotes) p.notes = item.notes
  return p
}

/** `sharedItemIds` are the live items' shared ids, in list order. */
export function metaPayloadFor(list: SharedList, sharedItemIds: string[]): ListMetaPayload {
  const p: ListMetaPayload = {
    v: 1,
    name: list.name,
    itemIds: sharedItemIds,
    showPrices: list.showPrices,
    showNotes: list.showNotes,
    status: 'published',
    updatedAt: list.updatedAt,
  }
  if (list.message) p.message = list.message
  if (list.eventDate) p.eventDate = list.eventDate
  return p
}

// ---- Publishing ----

/** Everything needed to sign and publish under one topic, for a current or a retired list. */
interface OwnerContext {
  listId: string
  topic: string
  contentKey: Uint8Array
  slotKey: Uint8Array
  ownerPubkey: string
  secretKey: string
  channel: OwnerChannel
}

function contextFor(deps: CoreDeps, k: { listId: string; ownerSecretKey: string; listSecret: string; relays: readonly string[] }): OwnerContext {
  const { topic, contentKey, slotKey } = deriveContentKeys(k.listSecret)
  const ownerPubkey = publicKeyOf(k.ownerSecretKey)
  return {
    listId: k.listId,
    topic,
    contentKey,
    slotKey,
    ownerPubkey,
    secretKey: k.ownerSecretKey,
    channel: new OwnerChannel(deps.transports(k.relays), topic, ownerPubkey),
  }
}

function ownerContext(deps: CoreDeps, list: SharedList): OwnerContext {
  return contextFor(deps, { listId: list.id, ownerSecretKey: list.ownerSecretKey, listSecret: list.listSecret, relays: list.relays })
}

async function publishAndCache(
  deps: CoreDeps,
  ctx: OwnerContext,
  d: string,
  event: NostrEvent,
  kind: PublishedEventReport['kind'],
): Promise<PublishedEventReport> {
  const result = await ctx.channel.publish(event)
  await cacheIfNewer(deps.db, ctx.topic, d, event, { pending: !result.ok })
  return { d, kind, result }
}

function signOptions(deps: CoreDeps, ctx: OwnerContext, previous: CachedEvent | undefined): SignOptions {
  return { topic: ctx.topic, secretKey: ctx.secretKey, createdAt: nextCreatedAt(deps.now(), previous?.event.created_at) }
}

function report(listId: string, events: PublishedEventReport[]): SyncReport {
  return { listId, ok: events.every((e) => e.result.ok), events }
}

/**
 * Publishes the payloads that differ from what this device last published,
 * events close to expiry (re-signed so the list does not lapse), and any of
 * its events that no relay has accepted yet. Items go before the meta event
 * so a giver who sees the new item order can find every item.
 */
async function syncPublished(deps: CoreDeps, ctx: OwnerContext, list: SharedList, force: boolean): Promise<PublishedEventReport[]> {
  const { topic, contentKey } = ctx
  const cached = new Map((await getCachedEvents(deps.db, topic)).map((r) => [r.d, r]))
  const items = (await deps.db.items.bulkGet(list.itemIds)).filter(
    (i): i is Item => i !== undefined && i.archivedAt === undefined,
  )
  const now = deps.now()
  const out: PublishedEventReport[] = []

  const publishIfChanged = async (d: string, payload: ItemPayload | ListMetaPayload, kind: 'meta' | 'item'): Promise<void> => {
    const prev = cached.get(d)
    const same = prev !== undefined && stableStringify(decryptJson(contentKey, prev.event.content, d)) === stableStringify(payload)
    if (same && !force && !expiresSoon(prev.event, now)) {
      if (prev.pending) out.push(await publishAndCache(deps, ctx, d, prev.event, 'republish'))
      return
    }
    const o = signOptions(deps, ctx, prev)
    const event = kind === 'meta' ? buildMetaEvent(payload as ListMetaPayload, contentKey, o) : buildItemEvent(payload as ItemPayload, contentKey, o)
    out.push(await publishAndCache(deps, ctx, d, event, kind))
  }

  const sharedIds: string[] = []
  for (const item of items) {
    const sharedId = sharedItemIdWith(ctx.slotKey, item.id)
    sharedIds.push(sharedId)
    await publishIfChanged(itemSlot(topic, sharedId), itemPayloadFor(item, list, sharedId), 'item')
  }
  await publishIfChanged(metaSlot(topic), metaPayloadFor(list, sharedIds), 'meta')
  return out
}

function lockKey(deps: CoreDeps, listId: string): string {
  return `${deps.db.name}:list:${listId}`
}

/**
 * Records whether the list's current topic still has events no relay has
 * accepted (`syncPending`), and clears `linkPending` once a relay has the
 * list's meta event under the current link. Leaves the record alone if the
 * list was rotated or deleted in the meantime.
 */
async function recordSyncState(deps: CoreDeps, listId: string, topic: string): Promise<void> {
  const rows = await getCachedEvents(deps.db, topic)
  const pending = rows.some((r) => r.pending)
  const meta = rows.find((r) => r.d === metaSlot(topic))
  const linkLive = meta !== undefined && !meta.pending
  await deps.db.transaction('rw', deps.db.sharedLists, async () => {
    const l = await deps.db.sharedLists.get(listId)
    if (!l || topicForSecret(l.listSecret) !== topic) return
    const before = `${l.syncPending === true}:${l.linkPending === true}`
    if (pending) l.syncPending = true
    else delete l.syncPending
    if (linkLive || l.status === 'draft') delete l.linkPending
    if (`${l.syncPending === true}:${l.linkPending === true}` !== before) await deps.db.sharedLists.put(l)
  })
}

async function markSyncPending(deps: CoreDeps, listId: string): Promise<void> {
  await deps.db.sharedLists.update(listId, { syncPending: true })
}

/** Republishes a published list after local changes. No-op for drafts and unpublished lists. */
export function syncList(deps: CoreDeps, listId: string, options: { force?: boolean } = {}): Promise<SyncReport> {
  return serialize(lockKey(deps, listId), async () => {
    const list = await requireList(deps.db, listId)
    if (list.status !== 'published') return report(listId, [])
    if (!list.syncPending) await markSyncPending(deps, listId)
    const ctx = ownerContext(deps, list)
    const events = await syncPublished(deps, ctx, list, options.force ?? false)
    await recordSyncState(deps, listId, ctx.topic)
    return report(listId, events)
  })
}

/** Syncs every published list that links the item. Call after creating, editing, archiving or deleting it. */
export async function syncListsForItem(deps: CoreDeps, itemId: string): Promise<SyncReport[]> {
  const lists = await findListsContainingItem(deps.db, itemId)
  return Promise.all(lists.map((l) => syncList(deps, l.id)))
}

/** Marks the list published and publishes meta and every linked item. */
export function publishList(deps: CoreDeps, listId: string): Promise<SyncReport> {
  return serialize(lockKey(deps, listId), async () => {
    const list = await deps.db.transaction('rw', deps.db.sharedLists, async () => {
      const l = await requireList(deps.db, listId)
      if (l.status !== 'published') {
        // A draft's link has never worked; an unpublished list's link shows "no longer shared" until this reaches a relay.
        if (l.status === 'draft') l.linkPending = true
        l.status = 'published'
        l.publishedAt ??= deps.now()
        l.updatedAt = Math.max(deps.now(), l.updatedAt + 1)
      }
      l.syncPending = true
      await deps.db.sharedLists.put(l)
      return l
    })
    const ctx = ownerContext(deps, list)
    const events = await syncPublished(deps, ctx, list, false)
    await recordSyncState(deps, listId, ctx.topic)
    return report(listId, events)
  })
}

interface UnpublishContent {
  name: string
  showPrices: boolean
  showNotes: boolean
  updatedAt: number
  /** Shared ids to tombstone, in addition to every item slot in the cache. */
  sharedItemIds: readonly string[]
}

function isUnpublishedMeta(ctx: OwnerContext, row: CachedEvent | undefined): boolean {
  if (!row) return false
  const meta = tryParse(parseListMetaPayload, decryptJson(ctx.contentKey, row.event.content, row.d))
  return meta !== null && meta.status === 'unpublished' && meta.itemIds.length === 0
}

/**
 * PROTOCOL.md section 9: an empty tombstone for every item slot (the given
 * ids plus every item slot in the cache) and meta with status 'unpublished'
 * and no items. Idempotent: what is already cut off is left alone, and what
 * no relay accepted yet is sent again.
 */
async function publishUnpublished(deps: CoreDeps, ctx: OwnerContext, content: UnpublishContent): Promise<PublishedEventReport[]> {
  const cached = await getCachedEvents(deps.db, ctx.topic)
  const byD = new Map(cached.map((r) => [r.d, r]))
  const itemIds = new Set(content.sharedItemIds)
  for (const r of cached) {
    const slot = parseSlot(r.d, ctx.topic)
    if (slot?.type === 'item') itemIds.add(slot.itemId)
  }
  const now = deps.now()
  const out: PublishedEventReport[] = []
  const settle = async (d: string, prev: CachedEvent | undefined, done: boolean, build: () => NostrEvent, kind: 'tombstone' | 'meta') => {
    if (done && prev && !isExpired(prev.event, now)) {
      if (prev.pending) out.push(await publishAndCache(deps, ctx, d, prev.event, 'republish'))
      return
    }
    out.push(await publishAndCache(deps, ctx, d, build(), kind))
  }
  for (const itemId of itemIds) {
    const d = itemSlot(ctx.topic, itemId)
    const prev = byD.get(d)
    await settle(d, prev, prev?.event.content === '', () => buildItemTombstone(itemId, signOptions(deps, ctx, prev)), 'tombstone')
  }
  const d = metaSlot(ctx.topic)
  const prev = byD.get(d)
  const meta: ListMetaPayload = {
    v: 1,
    name: content.name,
    itemIds: [],
    showPrices: content.showPrices,
    showNotes: content.showNotes,
    status: 'unpublished',
    updatedAt: content.updatedAt,
  }
  await settle(d, prev, isUnpublishedMeta(ctx, prev), () => buildMetaEvent(meta, ctx.contentKey, signOptions(deps, ctx, prev)), 'meta')
  return out
}

function unpublishContent(list: SharedList, slotKey: Uint8Array): UnpublishContent {
  return {
    name: list.name,
    showPrices: list.showPrices,
    showNotes: list.showNotes,
    updatedAt: list.updatedAt,
    sharedItemIds: list.itemIds.map((id) => sharedItemIdWith(slotKey, id)),
  }
}

export function unpublishList(deps: CoreDeps, listId: string): Promise<SyncReport> {
  return serialize(lockKey(deps, listId), async () => {
    const list = await deps.db.transaction('rw', deps.db.sharedLists, async () => {
      const l = await requireList(deps.db, listId)
      if (l.status === 'draft') throw new HippoError('not-published', 'list was never published')
      l.status = 'unpublished'
      l.updatedAt = Math.max(deps.now(), l.updatedAt + 1)
      l.syncPending = true
      delete l.linkPending
      await deps.db.sharedLists.put(l)
      return l
    })
    const ctx = ownerContext(deps, list)
    const events = await publishUnpublished(deps, ctx, unpublishContent(list, ctx.slotKey))
    await recordSyncState(deps, listId, ctx.topic)
    return report(listId, events)
  })
}

/** Resends the cut-off of an unpublished list (idempotent; only what is missing is sent). */
function resendUnpublished(deps: CoreDeps, listId: string): Promise<SyncReport> {
  return serialize(lockKey(deps, listId), async () => {
    const list = await requireList(deps.db, listId)
    if (list.status !== 'unpublished') return report(listId, [])
    const ctx = ownerContext(deps, list)
    const events = await publishUnpublished(deps, ctx, unpublishContent(list, ctx.slotKey))
    await recordSyncState(deps, listId, ctx.topic)
    return report(listId, events)
  })
}

// ---- Retired lists (rotation and deletion) ----

/** The retired record for a list's current keys, holding the secrets until the old link is cut off. */
async function retiredRecordFor(deps: CoreDeps, list: SharedList, reason: RetiredList['reason']): Promise<RetiredList> {
  const { topic, slotKey } = deriveContentKeys(list.listSecret)
  const record: RetiredList = {
    topic,
    ownerPubkey: publicKeyOf(list.ownerSecretKey),
    listId: list.id,
    reason,
    retiredAt: deps.now(),
  }
  if (list.status === 'draft') return record // never published: nothing to cut off
  const itemIds = new Set(list.itemIds.map((id) => sharedItemIdWith(slotKey, id)))
  for (const r of await getCachedEvents(deps.db, topic)) {
    const slot = parseSlot(r.d, topic)
    if (slot?.type === 'item') itemIds.add(slot.itemId)
  }
  record.pending = {
    ownerSecretKey: list.ownerSecretKey,
    listSecret: list.listSecret,
    relays: [...list.relays],
    name: list.name,
    itemIds: [...itemIds],
  }
  return record
}

function retiredLockKey(deps: CoreDeps, topic: string): string {
  return `${deps.db.name}:retired:${topic}`
}

/**
 * Cuts off a retired topic: publishes its unpublished meta and item
 * tombstones. Once every one of them has been accepted by at least one relay,
 * the old secrets are dropped from the record (topic and owner key stay, for
 * FR-25) and the old topic's cache is deleted. Safe to call repeatedly.
 */
function cutOffRetired(deps: CoreDeps, topic: string): Promise<SyncReport> {
  return serialize(retiredLockKey(deps, topic), async () => {
    const record = await deps.db.retiredLists.get(topic)
    if (!record?.pending) {
      if (record) await deleteCachedTopic(deps.db, topic)
      return report(record?.listId ?? '', [])
    }
    const p = record.pending
    const ctx = contextFor(deps, { listId: record.listId, ownerSecretKey: p.ownerSecretKey, listSecret: p.listSecret, relays: p.relays })
    const events = await publishUnpublished(deps, ctx, {
      name: p.name,
      showPrices: false,
      showNotes: false,
      updatedAt: record.retiredAt,
      sharedItemIds: p.itemIds,
    })
    const stillPending = (await getCachedEvents(deps.db, topic)).some((r) => r.pending)
    if (events.every((e) => e.result.ok) && !stillPending) {
      await deps.db.transaction('rw', deps.db.retiredLists, deps.db.events, async () => {
        const current = await deps.db.retiredLists.get(topic)
        if (current) {
          delete current.pending
          await deps.db.retiredLists.put(current)
        }
        await deleteCachedTopic(deps.db, topic)
      })
    }
    return report(record.listId, events)
  })
}

/** Retries cutting off every retired topic whose old link is not yet cut off. Call at startup and when back online. */
export async function repairRetiredLists(deps: CoreDeps, options: { listId?: string } = {}): Promise<SyncReport[]> {
  const pending = (await deps.db.retiredLists.toArray()).filter(
    (r) => r.pending !== undefined && (options.listId === undefined || r.listId === options.listId),
  )
  const out: SyncReport[] = []
  for (const r of pending) out.push(await cutOffRetired(deps, r.topic))
  return out
}

/** Retired records (no secrets) for a list, e.g. to show that an old link is still being cut off. */
export async function listRetiredLists(db: HippoDb): Promise<Array<Omit<RetiredList, 'pending'> & { cutOff: boolean }>> {
  return (await db.retiredLists.toArray()).map(({ pending, ...r }) => ({ ...r, cutOff: pending === undefined }))
}

/**
 * New list secret and owner key; publishes the list under the new topic,
 * then unpublishes the old topic so old link holders are cut off. Claims are
 * not migrated. The old keys are kept in a retired record (written in the
 * same transaction as the new keys, so a crash cannot lose them) until the
 * old link is cut off; `repairRetiredLists` retries. `unpublishedOld.ok` is
 * false while that is still pending.
 */
export function rotateList(deps: CoreDeps, listId: string): Promise<{ list: SharedList; published: SyncReport; unpublishedOld: SyncReport }> {
  return serialize(lockKey(deps, listId), async () => {
    const before = await requireList(deps.db, listId)
    if (before.status === 'draft') throw new HippoError('not-published', 'list was never published')
    const retired = await retiredRecordFor(deps, before, 'rotated')
    const after: SharedList = {
      ...before,
      ownerSecretKey: generateSigningKey(),
      listSecret: generateListSecret(),
      updatedAt: Math.max(deps.now(), before.updatedAt + 1),
    }
    delete after.syncPending
    delete after.linkPending
    if (after.status === 'published') {
      after.publishedAt = deps.now()
      after.syncPending = true
      after.linkPending = true // the new link works once a relay has it
    }
    await deps.db.transaction('rw', deps.db.sharedLists, deps.db.retiredLists, async () => {
      await deps.db.retiredLists.put(retired)
      await deps.db.sharedLists.put(after)
    })
    let published = report(listId, [])
    if (after.status === 'published') {
      const ctx = ownerContext(deps, after)
      published = report(listId, await syncPublished(deps, ctx, after, true))
      await recordSyncState(deps, listId, ctx.topic)
    }
    const unpublishedOld = await cutOffRetired(deps, retired.topic)
    return { list: after, published, unpublishedOld }
  })
}

/**
 * Deletes the list. Its topic and owner key are remembered (FR-25); a list
 * that was ever published is cut off first, and if no relay accepts that
 * yet, `repairRetiredLists` keeps trying. Returns the cut-off report, or
 * `null` for a draft.
 */
export function deleteSharedList(deps: CoreDeps, listId: string): Promise<SyncReport | null> {
  return serialize(lockKey(deps, listId), async () => {
    const list = await requireList(deps.db, listId)
    const retired = await retiredRecordFor(deps, list, 'deleted')
    await deps.db.transaction('rw', deps.db.sharedLists, deps.db.retiredLists, async () => {
      // Keep an older rotation record for the same topic if there is one.
      if (!(await deps.db.retiredLists.get(retired.topic))) await deps.db.retiredLists.put(retired)
      await deps.db.sharedLists.delete(listId)
    })
    if (!retired.pending) {
      await deleteCachedTopic(deps.db, retired.topic)
      return null
    }
    return cutOffRetired(deps, retired.topic)
  })
}

/** `https://host/base/#/l/<payload>`; a v1 payload when the list uses the default relays. */
export function buildShareLink(list: Pick<SharedList, 'ownerSecretKey' | 'listSecret' | 'relays'>, appBaseUrl: string): string {
  return shareLinkFor({ ownerPubkey: publicKeyOf(list.ownerSecretKey), listSecret: list.listSecret, relays: list.relays }, appBaseUrl)
}

/** The topic of a list's current secret (to detect FR-25 and to inspect the cache). */
export function topicOfList(list: Pick<SharedList, 'listSecret'>): string {
  return topicForSecret(list.listSecret)
}

/**
 * PROTOCOL.md section 8 for the owner: fetch my own events for the list,
 * republish cached events the relays lack (unchanged, same signature), then
 * publish anything local changes or near expiry still need, and retry
 * cutting off this list's retired topics.
 */
export function repairOwnerList(deps: CoreDeps, listId: string, options: { timeoutMs?: number } = {}): Promise<SyncReport> {
  const run = serialize(lockKey(deps, listId), async () => {
    const list = await requireList(deps.db, listId)
    if (list.status === 'draft') return report(listId, [])
    const ctx = ownerContext(deps, list)
    const remote = await ctx.channel.fetchOwnEvents(options.timeoutMs)
    const newestRemote = new Map<string, NostrEvent>()
    for (const e of remote) {
      const d = e.tags.find((t) => t[0] === 'd')?.[1]
      if (d === undefined) continue
      const cur = newestRemote.get(d)
      if (!cur || e.created_at > cur.created_at) newestRemote.set(d, e)
    }
    const now = deps.now()
    const out: PublishedEventReport[] = []
    for (const row of await getCachedEvents(deps.db, ctx.topic)) {
      if (isExpired(row.event, now)) continue // relays refuse it; a live list re-signs below
      if (list.status === 'published' && expiresSoon(row.event, now)) continue // re-signed below
      const r = newestRemote.get(row.d)
      const present = r !== undefined && (r.id === row.event.id || r.created_at > row.event.created_at)
      if (!present || row.pending) out.push(await publishAndCache(deps, ctx, row.d, row.event, 'republish'))
    }
    if (list.status === 'published') out.push(...(await syncPublished(deps, ctx, list, false)))
    await recordSyncState(deps, listId, ctx.topic)
    return report(listId, out)
  })
  return run.then(async (r) => {
    await repairRetiredLists(deps, { listId })
    return r
  })
}

export interface RetryReport {
  reports: SyncReport[]
  /** True while some list or retired link still has changes no relay has accepted. */
  pending: boolean
}

/** Whether any owned list (or the cut-off of a retired link) is still waiting for a relay. */
export async function hasPendingSync(db: HippoDb): Promise<boolean> {
  const lists = await db.sharedLists.toArray()
  if (lists.some((l) => l.syncPending === true && l.status !== 'draft')) return true
  return (await db.retiredLists.toArray()).some((r) => r.pending !== undefined)
}

/**
 * One retry pass for everything the owner side has not got onto a relay yet:
 * published lists with `syncPending` are synced (which resends their pending
 * events), unpublished lists resend their cut-off, and retired links are cut
 * off. Only lists that are pending are touched, so calling it often costs
 * nothing when all is sent. The app calls it at start, when the browser comes
 * online, when the page becomes visible, and on a backoff timer while
 * `pending` is true.
 */
export async function retryPendingSync(deps: CoreDeps): Promise<RetryReport> {
  const reports: SyncReport[] = []
  for (const l of await deps.db.sharedLists.toArray()) {
    if (!l.syncPending) continue
    if (l.status === 'published') reports.push(await syncList(deps, l.id))
    else if (l.status === 'unpublished') reports.push(await resendUnpublished(deps, l.id))
    else {
      await deps.db.transaction('rw', deps.db.sharedLists, async () => {
        const d = await deps.db.sharedLists.get(l.id)
        if (!d) return
        delete d.syncPending
        await deps.db.sharedLists.put(d)
      })
    }
  }
  reports.push(...(await repairRetiredLists(deps)))
  return { reports, pending: await hasPendingSync(deps.db) }
}
