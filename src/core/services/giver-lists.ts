// Lists shared with me (PRD 4.4). A GiverListSession loads the cached
// events, subscribes live, keeps a ListState, and exposes an immutable view
// model compatible with React's useSyncExternalStore.

import type { Filter } from 'nostr-tools/filter'
import { DEFAULT_RELAYS } from '../config.ts'
import { decryptJson } from '../crypto/aead.ts'
import { randomId } from '../crypto/bytes.ts'
import { deriveListKeys, generateSigningKey, publicKeyOf, topicForSecret, type ListKeys } from '../crypto/keys.ts'
import { parseShareLink } from '../crypto/link.ts'
import { cacheIfNewer, deleteCachedTopic, getCachedEvent, getCachedEvents } from '../db/event-cache.ts'
import type { HippoDb } from '../db/schema.ts'
import { HippoError } from '../errors.ts'
import { codePointLength } from '../model/guards.ts'
import { LIMITS } from '../model/limits.ts'
import type { ClaimPayload, GuestList, ItemPayload, ListMetaPayload } from '../model/types.ts'
import { parseListMetaPayload, tryParse } from '../model/validate.ts'
import { buildClaimEvent, nextCreatedAt } from '../protocol/build.ts'
import type { AcceptedClaim } from '../protocol/list-state.ts'
import { ListState } from '../protocol/list-state.ts'
import { resolveItemState, type ItemState, type ResolveClaim } from '../protocol/resolve.ts'
import { HIPPO_KIND, claimSlot, metaSlot } from '../protocol/slots.ts'
import type { EoseInfo, NostrEvent, PublishResult, Transport, Unsubscribe } from '../transport/types.ts'
import type { CoreDeps } from './deps.ts'
import { serialize } from './util.ts'

// ---- Guest list records ----

/** FR-25: this device owns a shared list with that topic. */
async function ownsTopic(db: HippoDb, topic: string): Promise<boolean> {
  const lists = await db.sharedLists.toArray()
  return lists.some((l) => topicForSecret(l.listSecret) === topic)
}

/**
 * Parses a share link and remembers the list (FR-24), generating this
 * device's guest key. Returns the existing record when the list was added
 * before. Throws `invalid-link`, or `own-list` when this device owns the list.
 */
export async function addGuestListFromLink(deps: CoreDeps, link: string): Promise<GuestList> {
  const parsed = parseShareLink(link)
  const topic = topicForSecret(parsed.listSecret)
  if (await ownsTopic(deps.db, topic)) {
    throw new HippoError('own-list', 'This is your own list. Hippo hides claims from list owners, so it cannot be opened as a guest on this device.')
  }
  return deps.db.transaction('rw', deps.db.guestLists, async () => {
    const existing = await deps.db.guestLists.get(topic)
    if (existing) {
      existing.lastOpenedAt = deps.now()
      await deps.db.guestLists.put(existing)
      return existing
    }
    const now = deps.now()
    const guest: GuestList = {
      topic,
      ownerPubkey: parsed.ownerPubkey,
      listSecret: parsed.listSecret,
      relays: parsed.relays ?? [...DEFAULT_RELAYS],
      guestSecretKey: generateSigningKey(),
      addedAt: now,
      lastOpenedAt: now,
    }
    await deps.db.guestLists.add(guest)
    return guest
  })
}

export interface GuestListSummary {
  topic: string
  /** From the cached meta event; undefined until the list has loaded once. */
  name?: string
  eventDate?: string
  unpublished: boolean
  nickname?: string
  addedAt: number
  lastOpenedAt: number
}

/** "Lists shared with me", most recently opened first, with names from the local cache. */
export async function listGuestLists(db: HippoDb): Promise<GuestListSummary[]> {
  const guests = await db.guestLists.orderBy('lastOpenedAt').reverse().toArray()
  return Promise.all(
    guests.map(async (g) => {
      const s: GuestListSummary = { topic: g.topic, unpublished: false, addedAt: g.addedAt, lastOpenedAt: g.lastOpenedAt }
      if (g.nickname) s.nickname = g.nickname
      const d = metaSlot(g.topic)
      const row = await getCachedEvent(db, g.topic, d)
      if (row && row.event.pubkey === g.ownerPubkey) {
        const meta = tryParse(parseListMetaPayload, decryptJson(deriveListKeys(g.listSecret).contentKey, row.event.content, d))
        if (meta) {
          s.name = meta.name
          if (meta.eventDate) s.eventDate = meta.eventDate
          s.unpublished = meta.status === 'unpublished'
        }
      }
      return s
    }),
  )
}

export async function removeGuestList(db: HippoDb, topic: string): Promise<void> {
  await db.guestLists.delete(topic)
  await deleteCachedTopic(db, topic)
}

function cleanNickname(nickname: string | undefined): string | undefined {
  const n = nickname?.replace(/\s+/g, ' ').trim()
  if (!n) return undefined
  if (codePointLength(n) > LIMITS.nickname) throw new HippoError('invalid-input', `nickname is longer than ${LIMITS.nickname} characters`)
  return n
}

// ---- View model ----

export type GiverListStatus = 'loading' | 'live' | 'offline' | 'unpublished'

export interface GiverItemView {
  item: ItemPayload
  state: ItemState
}

export interface RemovedItemView {
  itemId: string
  /** Last item content seen; null when the owner replaced it with a tombstone. */
  item: ItemPayload | null
  myClaims: ClaimPayload[]
}

export interface GiverListView {
  topic: string
  status: GiverListStatus
  meta: ListMetaPayload | null
  items: GiverItemView[]
  removedItemsWithMyClaims: RemovedItemView[]
  myPubkey: string
  nickname?: string
  /** My claim ids that no relay has accepted yet (retried by repair). */
  pendingClaimIds: string[]
}

export interface ClaimActionResult {
  claim: ClaimPayload
  result: PublishResult
}

export interface GiverSessionOptions {
  /** Time to wait for relays before showing 'offline'. */
  eoseTimeoutMs?: number
  /** Delay between reconnection attempts while offline. */
  retryMs?: number
}

/** Giver filter: owner events and all claims for the topic (PROTOCOL.md section 7). */
export function giverFilter(topic: string): Filter {
  return { kinds: [HIPPO_KIND], '#t': [topic] }
}

type Listener = () => void

export class GiverListSession {
  readonly topic: string
  private guest: GuestList
  private readonly deps: CoreDeps
  private readonly keys: ListKeys
  private readonly myPubkey: string
  private readonly state: ListState
  private readonly transport: Transport
  private readonly listeners = new Set<Listener>()
  private readonly pending = new Set<string>()
  private readonly eoseTimeoutMs: number
  private readonly retryMs: number
  private connection: 'loading' | 'live' | 'offline' = 'loading'
  private unsubscribe: Unsubscribe | null = null
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private snapshot: GiverListView
  private emitScheduled = false
  private stopped = false
  private startPromise: Promise<void> | null = null

  constructor(deps: CoreDeps, guest: GuestList, options: GiverSessionOptions = {}) {
    this.deps = deps
    this.guest = guest
    this.topic = guest.topic
    this.keys = deriveListKeys(guest.listSecret)
    if (this.keys.topic !== guest.topic) throw new HippoError('invalid-input', 'guest list topic does not match its secret')
    this.myPubkey = publicKeyOf(guest.guestSecretKey)
    this.state = new ListState({
      topic: guest.topic,
      ownerPubkey: guest.ownerPubkey,
      contentKey: this.keys.contentKey,
      claimsKey: this.keys.claimsKey,
    })
    this.transport = deps.transports(guest.relays)
    this.eoseTimeoutMs = options.eoseTimeoutMs ?? 8000
    this.retryMs = options.retryMs ?? 15000
    this.snapshot = this.buildView()
  }

  // ---- useSyncExternalStore ----

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): GiverListView => this.snapshot

  // ---- Lifecycle ----

  /** Loads the cache (status stays 'loading'), then subscribes live. Resolves once the cache is shown. */
  start(): Promise<void> {
    this.startPromise ??= (async () => {
      const rows = await getCachedEvents(this.deps.db, this.topic)
      for (const r of rows) if (r.pending) this.pending.add(r.event.id)
      this.state.ingestBatch(rows.map((r) => r.event))
      this.emit()
      if (!this.stopped) this.connect()
    })()
    return this.startPromise
  }

  stop(): void {
    this.stopped = true
    this.unsubscribe?.()
    this.unsubscribe = null
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
  }

  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t)
      if (!this.stopped) fn()
    }, ms)
    this.timers.add(t)
  }

  private connect(): void {
    this.unsubscribe?.()
    const remote: NostrEvent[] = []
    let eosed = false
    this.later(this.eoseTimeoutMs, () => {
      if (!eosed) this.goOffline()
    })
    this.unsubscribe = this.transport.subscribe(
      giverFilter(this.topic),
      (e) => {
        if (!eosed) remote.push(e)
        this.receive(e)
      },
      (info: EoseInfo) => {
        if (eosed) return
        eosed = true
        if (info.relaysReached === 0) {
          this.goOffline()
          return
        }
        this.connection = 'live'
        this.emit()
        void this.repairFrom(remote).catch(() => undefined)
      },
    )
  }

  private goOffline(): void {
    if (this.connection === 'live') return
    this.connection = 'offline'
    this.emit()
    this.later(this.retryMs, () => {
      if (this.connection !== 'live') this.connect()
    })
  }

  private receive(e: NostrEvent): void {
    const r = this.state.ingest(e)
    if (!r.accepted) return
    const a = r.accepted
    void cacheIfNewer(this.deps.db, this.topic, a.d, a.event).catch(() => undefined)
    this.emit()
  }

  private emit(): void {
    if (this.emitScheduled) return
    this.emitScheduled = true
    queueMicrotask(() => {
      this.emitScheduled = false
      this.snapshot = this.buildView()
      for (const l of [...this.listeners]) l()
    })
  }

  // ---- View ----

  private buildView(): GiverListView {
    const meta = this.state.meta?.payload ?? null
    const itemEvents = this.state.items()
    const claims = this.state.claims()
    const byItem = new Map<string, ResolveClaim[]>()
    for (const c of claims) {
      const list = byItem.get(c.payload.itemId) ?? []
      list.push({ eventId: c.event.id, pubkey: c.event.pubkey, payload: c.payload })
      byItem.set(c.payload.itemId, list)
    }
    const live = meta && meta.status === 'published' ? meta.itemIds : []
    const liveSet = new Set(live)
    const items: GiverItemView[] = []
    for (const id of live) {
      const item = itemEvents.get(id)?.payload
      if (!item) continue
      items.push({ item, state: resolveItemState(item, byItem.get(id) ?? [], { myPubkey: this.myPubkey }) })
    }
    const removed = new Map<string, RemovedItemView>()
    if (meta) {
      for (const c of this.myClaims()) {
        if (c.payload.status === 'withdrawn' || liveSet.has(c.payload.itemId)) continue
        const entry = removed.get(c.payload.itemId) ?? {
          itemId: c.payload.itemId,
          item: itemEvents.get(c.payload.itemId)?.payload ?? null,
          myClaims: [],
        }
        entry.myClaims.push(c.payload)
        removed.set(c.payload.itemId, entry)
      }
    }
    const status: GiverListStatus = meta?.status === 'unpublished' ? 'unpublished' : this.connection
    const view: GiverListView = {
      topic: this.topic,
      status,
      meta,
      items,
      removedItemsWithMyClaims: [...removed.values()],
      myPubkey: this.myPubkey,
      pendingClaimIds: this.myClaims()
        .filter((c) => this.pending.has(c.event.id))
        .map((c) => c.claimId),
    }
    if (this.guest.nickname) view.nickname = this.guest.nickname
    return view
  }

  private myClaims(): AcceptedClaim[] {
    return this.state.claims().filter((c) => c.event.pubkey === this.myPubkey)
  }

  private myClaim(claimId: string): AcceptedClaim {
    const c = this.state.get(claimSlot(this.topic, claimId))
    if (!c || c.type !== 'claim' || c.event.pubkey !== this.myPubkey) {
      throw new HippoError('not-my-claim', 'claim not found or not yours')
    }
    return c
  }

  private liveItem(itemId: string): { item: ItemPayload; state: ItemState } {
    const meta = this.state.meta?.payload
    if (!meta) throw new HippoError('item-unavailable', 'list has not loaded yet')
    if (meta.status !== 'published') throw new HippoError('list-unpublished', 'this list is no longer shared')
    const found = this.buildView().items.find((v) => v.item.id === itemId)
    if (!found) throw new HippoError('item-unavailable', 'item is not on this list')
    return found
  }

  // ---- Claim actions ----

  private async publishClaim(payload: ClaimPayload): Promise<ClaimActionResult> {
    return serialize(`${this.deps.db.name}:claim:${payload.id}`, async () => {
      const d = claimSlot(this.topic, payload.id)
      const prev = await getCachedEvent(this.deps.db, this.topic, d)
      const current = this.state.get(d)
      const previousCreatedAt = Math.max(prev?.event.created_at ?? -1, current?.event.created_at ?? -1)
      const o: { topic: string; secretKey: string; createdAt: number; eventDate?: string } = {
        topic: this.topic,
        secretKey: this.guest.guestSecretKey,
        createdAt: nextCreatedAt(this.deps.now(), previousCreatedAt < 0 ? undefined : previousCreatedAt),
      }
      const eventDate = this.state.meta?.payload.eventDate
      if (eventDate) o.eventDate = eventDate
      const event = buildClaimEvent(payload, this.keys.claimsKey, o)
      // Show it immediately; relays confirm (or not) afterwards.
      this.state.ingest(event)
      this.pending.add(event.id)
      await cacheIfNewer(this.deps.db, this.topic, d, event, true)
      this.emit()
      const result = await this.transport.publish(event)
      if (result.ok) {
        this.pending.delete(event.id)
        await cacheIfNewer(this.deps.db, this.topic, d, event, false)
        this.emit()
      }
      return { claim: payload, result }
    })
  }

  private newClaim(itemId: string, fields: Pick<ClaimPayload, 'kind' | 'quantity' | 'amount'>): ClaimPayload {
    const now = this.deps.now()
    const c: ClaimPayload = { v: 1, id: randomId(), itemId, kind: fields.kind, status: 'reserved', createdAt: now, updatedAt: now }
    if (fields.quantity !== undefined) c.quantity = fields.quantity
    if (fields.amount !== undefined) c.amount = fields.amount
    if (this.guest.nickname) c.nickname = this.guest.nickname
    return c
  }

  /** "I'll get this" (FR-19). On an item that already has pledges, use `coverTheRest`. */
  async claim(itemId: string, quantity = 1): Promise<ClaimActionResult> {
    const { state } = this.liveItem(itemId)
    if (state.pledgeCount > 0) throw new HippoError('invalid-input', 'this item has pledges; use "cover the rest"')
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw new HippoError('invalid-input', 'quantity must be a positive integer')
    if (quantity > state.remainingQuantity) throw new HippoError('item-unavailable', 'not enough quantity left')
    return this.publishClaim(this.newClaim(itemId, { kind: 'full', quantity }))
  }

  /** Pledge `amount` minor units in the item currency (FR-20). */
  async pledge(itemId: string, amount: number): Promise<ClaimActionResult> {
    const { item } = this.liveItem(itemId)
    if (!item.allowContributions) throw new HippoError('contributions-disabled', 'this item does not accept contributions')
    if (!item.price) throw new HippoError('contributions-disabled', 'this item has no price to contribute towards')
    this.checkAmount(amount)
    return this.publishClaim(this.newClaim(itemId, { kind: 'pledge', amount: { amount, currency: item.price.currency } }))
  }

  /** Pledges exactly what is still needed (PRD 4.6). Allowed even if contributions were turned off later. */
  async coverTheRest(itemId: string): Promise<ClaimActionResult> {
    const { item, state } = this.liveItem(itemId)
    if (!item.price || state.remainingAmount === undefined) {
      throw new HippoError('contributions-disabled', 'this item has no price; claim it instead')
    }
    if (state.remainingAmount <= 0) throw new HippoError('item-unavailable', 'this item is already fully covered')
    return this.publishClaim(
      this.newClaim(itemId, { kind: 'pledge', amount: { amount: state.remainingAmount, currency: item.price.currency } }),
    )
  }

  private checkAmount(amount: number): void {
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > LIMITS.amount) {
      throw new HippoError('invalid-input', 'amount must be a positive whole number of minor units')
    }
  }

  /** Changes the quantity of a full claim or the amount of a pledge. */
  async updateClaim(claimId: string, change: { quantity?: number; amount?: number }): Promise<ClaimActionResult> {
    const prev = this.myClaim(claimId).payload
    if (prev.status === 'withdrawn') throw new HippoError('invalid-input', 'claim was withdrawn')
    const next: ClaimPayload = { ...prev, updatedAt: Math.max(this.deps.now(), prev.updatedAt + 1) }
    if (prev.kind === 'full' && change.quantity !== undefined) {
      if (!Number.isSafeInteger(change.quantity) || change.quantity < 1 || change.quantity > LIMITS.quantity) {
        throw new HippoError('invalid-input', 'quantity must be a positive integer')
      }
      next.quantity = change.quantity
    }
    if (prev.kind === 'pledge' && change.amount !== undefined && prev.amount) {
      this.checkAmount(change.amount)
      next.amount = { amount: change.amount, currency: prev.amount.currency }
    }
    return this.publishClaim(next)
  }

  async markPurchased(claimId: string, purchased = true): Promise<ClaimActionResult> {
    const prev = this.myClaim(claimId).payload
    if (prev.status === 'withdrawn') throw new HippoError('invalid-input', 'claim was withdrawn')
    return this.publishClaim({ ...prev, status: purchased ? 'purchased' : 'reserved', updatedAt: Math.max(this.deps.now(), prev.updatedAt + 1) })
  }

  async withdraw(claimId: string): Promise<ClaimActionResult> {
    const prev = this.myClaim(claimId).payload
    return this.publishClaim({ ...prev, status: 'withdrawn', updatedAt: Math.max(this.deps.now(), prev.updatedAt + 1) })
  }

  /** Sets the nickname for future claims; with `applyToExisting`, republishes my live claims with it. */
  async setNickname(nickname: string | undefined, options: { applyToExisting?: boolean } = {}): Promise<ClaimActionResult[]> {
    const clean = cleanNickname(nickname)
    const guest = { ...this.guest }
    if (clean) guest.nickname = clean
    else delete guest.nickname
    await this.deps.db.guestLists.put(guest)
    this.guest = guest
    this.emit()
    if (!options.applyToExisting) return []
    const out: ClaimActionResult[] = []
    for (const c of this.myClaims()) {
      if (c.payload.status === 'withdrawn' || c.payload.nickname === clean) continue
      const next: ClaimPayload = { ...c.payload, updatedAt: Math.max(this.deps.now(), c.payload.updatedAt + 1) }
      if (clean) next.nickname = clean
      else delete next.nickname
      out.push(await this.publishClaim(next))
    }
    return out
  }

  // ---- Repair (PROTOCOL.md section 8) ----

  /** Fetches the topic from relays and republishes cached events they are missing. */
  async repair(options: { timeoutMs?: number } = {}): Promise<PublishResult[]> {
    const remote = await this.transport.fetch(giverFilter(this.topic), options.timeoutMs === undefined ? undefined : { timeoutMs: options.timeoutMs })
    for (const e of remote) this.receive(e)
    return this.repairFrom(remote)
  }

  /**
   * Republishes, unchanged, every current event this client holds that the
   * relays lack: my own claims first (required), then other authors' events
   * (optional in the protocol, cheap, and it helps lists survive relay loss).
   */
  private async repairFrom(remote: readonly NostrEvent[]): Promise<PublishResult[]> {
    const remoteBySlot = new Map<string, NostrEvent>()
    for (const e of remote) {
      const d = e.tags.find((t) => t[0] === 'd')?.[1]
      if (d === undefined) continue
      const cur = remoteBySlot.get(`${e.pubkey}:${d}`)
      if (!cur || e.created_at > cur.created_at) remoteBySlot.set(`${e.pubkey}:${d}`, e)
    }
    const missing = this.state.all().filter((a) => {
      const r = remoteBySlot.get(`${a.event.pubkey}:${a.d}`)
      return this.pending.has(a.event.id) || !r || (r.id !== a.event.id && r.created_at <= a.event.created_at)
    })
    missing.sort((a, b) => Number(b.event.pubkey === this.myPubkey) - Number(a.event.pubkey === this.myPubkey))
    const results: PublishResult[] = []
    for (const a of missing) {
      const result = await this.transport.publish(a.event)
      results.push(result)
      if (result.ok && this.pending.delete(a.event.id)) {
        await cacheIfNewer(this.deps.db, this.topic, a.d, a.event, false)
        this.emit()
      }
    }
    return results
  }
}

/**
 * Opens a remembered list as a giver. Refuses with `own-list` when this
 * device owns the list (FR-25), and `not-found` when it was never added.
 * Call `start()` on the result; call `stop()` when the screen unmounts.
 */
export async function openGuestList(deps: CoreDeps, topic: string, options: GiverSessionOptions = {}): Promise<GiverListSession> {
  if (await ownsTopic(deps.db, topic)) {
    throw new HippoError('own-list', 'This is your own list. Hippo hides claims from list owners, so it cannot be opened as a guest on this device.')
  }
  const guest = await deps.db.guestLists.get(topic)
  if (!guest) throw new HippoError('not-found', 'list not found on this device')
  guest.lastOpenedAt = deps.now()
  await deps.db.guestLists.put(guest)
  return new GiverListSession(deps, guest, options)
}
