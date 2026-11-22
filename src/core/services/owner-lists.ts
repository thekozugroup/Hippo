// Shared lists I own (PRD 4.3, PROTOCOL.md sections 4, 8, 9). All network
// access goes through OwnerChannel, which only ever asks for the owner's own
// events; owner code never derives the claims key.

import { DEFAULT_RELAYS, sameRelaySet } from '../config.ts'
import { decryptJson } from '../crypto/aead.ts'
import { randomId } from '../crypto/bytes.ts'
import { deriveContentKeys, generateListSecret, generateSigningKey, publicKeyOf, topicForSecret } from '../crypto/keys.ts'
import { buildShareUrl, encodeSharePayload } from '../crypto/link.ts'
import { cacheIfNewer, deleteCachedTopic, getCachedEvents } from '../db/event-cache.ts'
import type { CachedEvent, HippoDb } from '../db/schema.ts'
import { getSettings } from '../db/settings.ts'
import { HippoError } from '../errors.ts'
import { SchemaError, readOptionalDate, readOptionalString, readString } from '../model/guards.ts'
import { LIMITS } from '../model/limits.ts'
import type { Item, ItemPayload, ListMetaPayload, SharedList } from '../model/types.ts'
import { buildItemEvent, buildItemTombstone, buildMetaEvent, nextCreatedAt } from '../protocol/build.ts'
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

// ---- Payloads ----

export function itemPayloadFor(item: Item, list: Pick<SharedList, 'showPrices' | 'showNotes'>): ItemPayload {
  const p: ItemPayload = {
    v: 1,
    id: item.id,
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

export function metaPayloadFor(list: SharedList, liveItemIds: string[]): ListMetaPayload {
  const p: ListMetaPayload = {
    v: 1,
    name: list.name,
    itemIds: liveItemIds,
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

interface OwnerContext {
  list: SharedList
  topic: string
  contentKey: Uint8Array
  ownerPubkey: string
  channel: OwnerChannel
}

function ownerContext(deps: CoreDeps, list: SharedList): OwnerContext {
  const { topic, contentKey } = deriveContentKeys(list.listSecret)
  const ownerPubkey = publicKeyOf(list.ownerSecretKey)
  return { list, topic, contentKey, ownerPubkey, channel: new OwnerChannel(deps.transports(list.relays), topic, ownerPubkey) }
}

async function publishAndCache(
  deps: CoreDeps,
  ctx: OwnerContext,
  d: string,
  event: NostrEvent,
  kind: PublishedEventReport['kind'],
): Promise<PublishedEventReport> {
  const result = await ctx.channel.publish(event)
  await cacheIfNewer(deps.db, ctx.topic, d, event, !result.ok)
  return { d, kind, result }
}

function signOptions(deps: CoreDeps, ctx: OwnerContext, previous: CachedEvent | undefined) {
  const o: { topic: string; secretKey: string; createdAt: number; eventDate?: string } = {
    topic: ctx.topic,
    secretKey: ctx.list.ownerSecretKey,
    createdAt: nextCreatedAt(deps.now(), previous?.event.created_at),
  }
  if (ctx.list.eventDate) o.eventDate = ctx.list.eventDate
  return o
}

function report(listId: string, events: PublishedEventReport[]): SyncReport {
  return { listId, ok: events.every((e) => e.result.ok), events }
}

/**
 * Publishes the payloads that differ from what this device last published,
 * plus any of its events that no relay has accepted yet. Items go before the
 * meta event so a giver who sees the new item order can find every item.
 */
async function syncPublished(deps: CoreDeps, ctx: OwnerContext, force: boolean): Promise<PublishedEventReport[]> {
  const { list, topic, contentKey } = ctx
  const cached = new Map((await getCachedEvents(deps.db, topic)).map((r) => [r.d, r]))
  const items = (await deps.db.items.bulkGet(list.itemIds)).filter(
    (i): i is Item => i !== undefined && i.archivedAt === undefined,
  )
  const out: PublishedEventReport[] = []

  const publishIfChanged = async (
    d: string,
    payload: ItemPayload | ListMetaPayload,
    kind: 'meta' | 'item',
  ): Promise<void> => {
    const prev = cached.get(d)
    const same = prev !== undefined && stableStringify(decryptJson(contentKey, prev.event.content, d)) === stableStringify(payload)
    if (same && !force) {
      if (prev.pending) out.push(await publishAndCache(deps, ctx, d, prev.event, 'republish'))
      return
    }
    const o = signOptions(deps, ctx, prev)
    const event = kind === 'meta' ? buildMetaEvent(payload as ListMetaPayload, contentKey, o) : buildItemEvent(payload as ItemPayload, contentKey, o)
    out.push(await publishAndCache(deps, ctx, d, event, kind))
  }

  for (const item of items) await publishIfChanged(itemSlot(topic, item.id), itemPayloadFor(item, list), 'item')
  await publishIfChanged(metaSlot(topic), metaPayloadFor(list, items.map((i) => i.id)), 'meta')
  return out
}

function lockKey(deps: CoreDeps, listId: string): string {
  return `${deps.db.name}:list:${listId}`
}

/** Republishes a published list after local changes. No-op for drafts and unpublished lists. */
export function syncList(deps: CoreDeps, listId: string, options: { force?: boolean } = {}): Promise<SyncReport> {
  return serialize(lockKey(deps, listId), async () => {
    const list = await requireList(deps.db, listId)
    if (list.status !== 'published') return report(listId, [])
    return report(listId, await syncPublished(deps, ownerContext(deps, list), options.force ?? false))
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
        l.status = 'published'
        l.publishedAt ??= deps.now()
        l.updatedAt = Math.max(deps.now(), l.updatedAt + 1)
        await deps.db.sharedLists.put(l)
      }
      return l
    })
    return report(listId, await syncPublished(deps, ownerContext(deps, list), false))
  })
}

/**
 * PROTOCOL.md section 9: meta with status 'unpublished' and no items, and an
 * empty tombstone for every item slot this device ever published.
 */
async function publishUnpublished(deps: CoreDeps, ctx: OwnerContext): Promise<PublishedEventReport[]> {
  const cached = await getCachedEvents(deps.db, ctx.topic)
  const itemIds = new Set(ctx.list.itemIds)
  const byD = new Map(cached.map((r) => [r.d, r]))
  for (const r of cached) {
    const slot = parseSlot(r.d, ctx.topic)
    if (slot?.type === 'item') itemIds.add(slot.itemId)
  }
  const out: PublishedEventReport[] = []
  for (const itemId of itemIds) {
    const d = itemSlot(ctx.topic, itemId)
    const prev = byD.get(d)
    if (prev?.event.content === '') {
      if (prev.pending) out.push(await publishAndCache(deps, ctx, d, prev.event, 'republish'))
      continue
    }
    out.push(await publishAndCache(deps, ctx, d, buildItemTombstone(itemId, signOptions(deps, ctx, prev)), 'tombstone'))
  }
  const d = metaSlot(ctx.topic)
  const meta: ListMetaPayload = {
    v: 1,
    name: ctx.list.name,
    itemIds: [],
    showPrices: ctx.list.showPrices,
    showNotes: ctx.list.showNotes,
    status: 'unpublished',
    updatedAt: ctx.list.updatedAt,
  }
  out.push(await publishAndCache(deps, ctx, d, buildMetaEvent(meta, ctx.contentKey, signOptions(deps, ctx, byD.get(d))), 'meta'))
  return out
}

export function unpublishList(deps: CoreDeps, listId: string): Promise<SyncReport> {
  return serialize(lockKey(deps, listId), async () => {
    const list = await deps.db.transaction('rw', deps.db.sharedLists, async () => {
      const l = await requireList(deps.db, listId)
      if (l.status === 'draft') throw new HippoError('not-published', 'list was never published')
      l.status = 'unpublished'
      l.updatedAt = Math.max(deps.now(), l.updatedAt + 1)
      await deps.db.sharedLists.put(l)
      return l
    })
    return report(listId, await publishUnpublished(deps, ownerContext(deps, list)))
  })
}

/**
 * New list secret and owner key; publishes the list under the new topic,
 * then unpublishes the old topic without `movedTo` so old link holders are
 * cut off. Claims are not migrated. Returns reports for both topics.
 */
export function rotateList(deps: CoreDeps, listId: string): Promise<{ list: SharedList; published: SyncReport; unpublishedOld: SyncReport }> {
  return serialize(lockKey(deps, listId), async () => {
    const before = await requireList(deps.db, listId)
    if (before.status === 'draft') throw new HippoError('not-published', 'list was never published')
    const oldCtx = ownerContext(deps, before)
    const after: SharedList = {
      ...before,
      ownerSecretKey: generateSigningKey(),
      listSecret: generateListSecret(),
      status: 'published',
      updatedAt: Math.max(deps.now(), before.updatedAt + 1),
      publishedAt: deps.now(),
    }
    await deps.db.sharedLists.put(after)
    const published = report(listId, await syncPublished(deps, ownerContext(deps, after), true))
    const unpublishedOld = report(listId, await publishUnpublished(deps, { ...oldCtx, list: { ...before, updatedAt: after.updatedAt } }))
    await deleteCachedTopic(deps.db, oldCtx.topic)
    return { list: after, published, unpublishedOld }
  })
}

/** Unpublishes a published list, then deletes it and its cached events. */
export async function deleteSharedList(deps: CoreDeps, listId: string): Promise<SyncReport | null> {
  const list = await requireList(deps.db, listId)
  const r = list.status === 'published' ? await unpublishList(deps, listId) : null
  await deps.db.sharedLists.delete(listId)
  await deleteCachedTopic(deps.db, topicForSecret(list.listSecret))
  return r
}

/** `https://host/base/#/l/<payload>`; a v1 payload when the list uses the default relays. */
export function buildShareLink(list: Pick<SharedList, 'ownerSecretKey' | 'listSecret' | 'relays'>, appBaseUrl: string): string {
  const payload = encodeSharePayload({
    ownerPubkey: publicKeyOf(list.ownerSecretKey),
    listSecret: list.listSecret,
    ...(sameRelaySet(list.relays, DEFAULT_RELAYS) ? {} : { relays: list.relays }),
  })
  return buildShareUrl(appBaseUrl, payload)
}

/** The topic of a list's current secret (to detect FR-25 and to inspect the cache). */
export function topicOfList(list: Pick<SharedList, 'listSecret'>): string {
  return topicForSecret(list.listSecret)
}

/**
 * PROTOCOL.md section 8 for the owner: fetch my own events for the list,
 * republish cached events the relays lack (unchanged, same signature), then
 * publish anything local changes still need.
 */
export function repairOwnerList(deps: CoreDeps, listId: string, options: { timeoutMs?: number } = {}): Promise<SyncReport> {
  return serialize(lockKey(deps, listId), async () => {
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
    const out: PublishedEventReport[] = []
    for (const row of await getCachedEvents(deps.db, ctx.topic)) {
      const r = newestRemote.get(row.d)
      const present = r !== undefined && (r.id === row.event.id || r.created_at > row.event.created_at)
      if (!present || row.pending) out.push(await publishAndCache(deps, ctx, row.d, row.event, 'republish'))
    }
    if (list.status === 'published') out.push(...(await syncPublished(deps, ctx, false)))
    return report(listId, out)
  })
}
