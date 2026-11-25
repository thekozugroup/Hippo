// The account sync engine, PROTOCOL.md section 12. Local-first: every screen reads the local
// database, and this only moves changes in the background. One pass (`runAccountSync`):
//
// 1. Fetch the account's records (everything at sign-in and once a day, else only what came after
//    the last one seen), or take the events a live subscription delivered.
// 2. In one database transaction: stamp local changes, merge every valid remote record into this
//    device's state field by field, write what changed to the local tables (with the checks a
//    backup import applies), and stamp anything the merge itself changed locally.
// 3. Publish every record this device holds a version of that the sync servers do not have.
//
// Two devices that have seen the same versions hold the same state, so they stop writing: a device
// publishes a record only when its merged state differs from what it received.

import Dexie from 'dexie'
import type { Filter } from 'nostr-tools/filter'
import { DEFAULT_RELAYS } from '../config.ts'
import { randomId } from '../crypto/bytes.ts'
import { publicKeyOf, topicForSecret } from '../crypto/keys.ts'
import { deleteCachedTopic } from '../db/event-cache.ts'
import type { AccountRecordRow, HippoDb, Stamp } from '../db/schema.ts'
import { getSettings, sanitizeRelays } from '../db/settings.ts'
import { LIMITS } from '../model/limits.ts'
import { SchemaError } from '../model/guards.ts'
import type { GuestList, RetiredList, SharedList } from '../model/types.ts'
import { expirationOf, nextCreatedAt, REFRESH_BEFORE_EXPIRY } from '../protocol/build.ts'
import { HIPPO_KIND } from '../protocol/slots.ts'
import type { CoreDeps } from '../services/deps.ts'
import { LINK_PREVIEW_SETTING_KEY } from '../services/link-preview.ts'
import { primeOwnerCache, retiredRecordFor } from '../services/owner-lists.ts'
import { isOwnListIdentity } from '../services/ownership.ts'
import type { EoseInfo, NostrEvent, Transport, Unsubscribe } from '../transport/types.ts'
import { deriveAccountKeys, type AccountKeys } from './keys.ts'
import {
  acceptAccountEvent,
  accountSlot,
  ACCOUNT_MAX_RECORDS,
  buildEmptyEvent,
  buildRecordEvent,
  checkState,
  deletedState,
  latestTime,
  markerSlot,
  mergeStates,
  nextStamp,
  PROFILE_ID,
  projectCategory,
  projectGuest,
  projectItem,
  projectList,
  projectProfile,
  projectRetired,
  RECORD_TYPES,
  sameState,
  stampChanges,
  toCategory,
  toGuest,
  toItem,
  toList,
  toProfile,
  toRetired,
  type AcceptedAccountEvent,
  type Profile,
  type RecordPayload,
  type RecordState,
  type RecordType,
} from './records.ts'
import { getAccountState, getDeviceId, RECOVERY_SAVED_SETTING_KEY, updateAccountState, type AccountState } from './state.ts'

const DAY_MS = 24 * 60 * 60 * 1000
/** A full fetch at least this often, so slots the sync servers lost are found and sent again. */
const FULL_FETCH_EVERY_MS = DAY_MS
/** Overlap for incremental fetches, for devices whose clocks differ a little. */
const SINCE_MARGIN_S = 10 * 60
/** Deleted records are kept on the sync servers this long after deletion, then left to expire. */
const TOMBSTONE_KEEP_MS = 2 * 365 * DAY_MS
/** Bounds for one fetch: events and bytes of content. */
const FETCH_MAX_EVENTS = ACCOUNT_MAX_RECORDS * 2
const FETCH_MAX_BYTES = 32 * 1024 * 1024
const DEFAULT_FETCH_TIMEOUT_MS = 8000
const PUBLISH_BATCH = 4

/** Every table a sync pass reads or writes, in one transaction. */
function tables(db: HippoDb) {
  return [db.items, db.categories, db.sharedLists, db.guestLists, db.retiredLists, db.settings, db.events, db.accountRecords]
}

/** The relays the account uses: the default ones always (so a recovery code alone can find it), plus any set in Settings. */
export async function accountRelays(db: HippoDb): Promise<string[]> {
  const own = (await getSettings(db)).relays ?? []
  return [...new Set([...own, ...DEFAULT_RELAYS])].slice(0, LIMITS.relays)
}

export function accountFilter(keys: Pick<AccountKeys, 'pubkey' | 'topic'>, since?: number): Filter {
  return { kinds: [HIPPO_KIND], authors: [keys.pubkey], '#t': [keys.topic], ...(since !== undefined ? { since } : {}) }
}

// ------------------------------------------------------------------ fetching

export interface Collected {
  events: NostrEvent[]
  /** At least one relay answered (EOSE). */
  answered: boolean
}

/** Everything relays return for a filter until they all answer or the time runs out, within fixed bounds. */
export function collectEvents(t: Transport, filter: Filter, timeoutMs: number): Promise<Collected> {
  return new Promise((resolve) => {
    const events: NostrEvent[] = []
    const ids = new Set<string>()
    let bytes = 0
    let done = false
    let answered = false
    let stop: Unsubscribe = () => undefined
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      stop()
      resolve({ events, answered })
    }
    const timer = setTimeout(finish, timeoutMs)
    stop = t.subscribe(
      filter,
      (e) => {
        if (done || ids.has(e.id) || events.length >= FETCH_MAX_EVENTS) return
        const size = typeof e.content === 'string' ? e.content.length : 0
        if (bytes + size > FETCH_MAX_BYTES) return
        bytes += size
        ids.add(e.id)
        events.push(e)
      },
      (info: EoseInfo) => {
        answered = info.relaysAnswered > 0
        setTimeout(finish, 0)
      },
    )
    if (done) stop()
  })
}

/** The newest accepted event per slot (higher `created_at`, then lower id), and whether a retirement marker came. */
export function newestPerSlot(raw: readonly unknown[], keys: AccountKeys, now: number): { bySlot: Map<string, AcceptedAccountEvent>; retired: boolean; newest: number } {
  const bySlot = new Map<string, AcceptedAccountEvent>()
  let retired = false
  let newest = 0
  for (const r of raw) {
    const a = acceptAccountEvent(r, keys, now)
    if (!a) continue
    newest = Math.max(newest, a.createdAt)
    if (a.payload?.type === 'account') {
      retired = true
      continue
    }
    const cur = bySlot.get(a.d)
    if (!cur || a.createdAt > cur.createdAt || (a.createdAt === cur.createdAt && a.id < cur.id)) bySlot.set(a.d, a)
  }
  return { bySlot, retired, newest }
}

// ------------------------------------------------------------------ local state

interface LocalRecord {
  type: RecordType
  id: string
  data: Record<string, unknown>
}

const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

/** The profile as this device holds it. "Setup done" and "recovery code saved" never go back once set. */
async function localProfile(db: HippoDb, row: AccountRecordRow | undefined): Promise<Profile> {
  const s = await getSettings(db)
  const [lp, saved] = await db.settings.bulkGet([LINK_PREVIEW_SETTING_KEY, RECOVERY_SAVED_SETTING_KEY])
  const p: Profile = {}
  if (s.ownerName) p.ownerName = s.ownerName
  if (lp?.value === true) p.linkPreview = true
  if (s.relays) p.relays = s.relays
  const status = s.onboarding?.status
  if (status === 'completed' || status === 'dismissed' || row?.data.setupDone === true) p.setupDone = true
  const savedAt = isTime(saved?.value) ? saved.value : isTime(row?.data.recoverySavedAt) ? row.data.recoverySavedAt : undefined
  if (savedAt !== undefined) p.recoverySavedAt = savedAt
  return p
}

async function readLocal(db: HippoDb, keys: AccountKeys, rows: Map<string, AccountRecordRow>): Promise<Map<string, LocalRecord>> {
  const [items, categories, lists, retired, guests] = await Promise.all([
    db.items.toArray(),
    db.categories.toArray(),
    db.sharedLists.toArray(),
    db.retiredLists.toArray(),
    db.guestLists.toArray(),
  ])
  const out = new Map<string, LocalRecord>()
  const add = (type: RecordType, id: string, data: Record<string, unknown>) => out.set(accountSlot(keys, type, id), { type, id, data })
  for (const i of items) add('wish', i.id, projectItem(i))
  for (const c of categories) add('category', c.id, projectCategory(c))
  for (const l of lists) {
    const rotated = retired.filter((r) => r.listId === l.id && r.reason === 'rotated').map((r) => r.topic)
    add('list', l.id, projectList(l, rotated))
  }
  for (const r of retired) add('retired', r.topic, projectRetired(r))
  for (const g of guests) add('guest', g.topic, projectGuest(g))
  const profileSlot = accountSlot(keys, 'profile', PROFILE_ID)
  add('profile', PROFILE_ID, projectProfile(await localProfile(db, rows.get(profileSlot))))
  return out
}

/**
 * The first merge after signing in: for a record both sides hold, a field that differs takes the
 * synced value (it gets a zero stamp here), and a field the account never had keeps this device's
 * value. Nothing that exists only here is lost; duplicates by id collapse.
 */
function initialCandidate(local: Record<string, unknown>, remote: RecordState, stamp: Stamp, device: string): RecordState {
  const f: Record<string, Stamp> = {}
  for (const k of new Set([...Object.keys(local), ...Object.keys(remote.f)])) {
    const remoteStamp = remote.f[k]
    if (JSON.stringify(local[k] ?? null) === JSON.stringify(remote.data[k] ?? null)) {
      if (remoteStamp) f[k] = remoteStamp
    } else if (remoteStamp) f[k] = [0, device]
    else f[k] = stamp
  }
  return { data: JSON.parse(JSON.stringify(local)) as Record<string, unknown>, f }
}

// ------------------------------------------------------------------ applying a record to the local tables

interface ApplyContext {
  deps: Pick<CoreDeps, 'db' | 'now'>
  /** Lists whose keys are new here: their published events are fetched and cached after the pass. */
  primeLists: Set<string>
}

async function purgeGuestFor(db: HippoDb, topic: string, ownerPubkey: string): Promise<void> {
  // A list this device now owns (or retired) is never also a list shared with it (FR-25), and its
  // cached claims are dropped: the owner's devices never keep who is getting what (FR-17).
  const guests = await db.guestLists.toArray()
  for (const g of guests) {
    if (g.topic === topic || g.ownerPubkey === ownerPubkey) {
      await db.guestLists.delete(g.topic)
      await deleteCachedTopic(db, g.topic)
    }
  }
}

/** Writes a merged record to the local tables. Returns a reason when this device refuses it. */
async function applyRecord(ctx: ApplyContext, type: RecordType, id: string, s: RecordState): Promise<string | undefined> {
  const { db } = ctx.deps
  switch (type) {
    case 'wish': {
      if (s.del) {
        if (!(await db.items.get(id))) return undefined
        await db.items.delete(id)
        await db.sharedLists.toCollection().modify((l) => {
          if (l.itemIds.includes(id)) l.itemIds = l.itemIds.filter((x) => x !== id)
        })
        return undefined
      }
      await db.items.put(toItem(id, s.data))
      return undefined
    }
    case 'category': {
      if (s.del) {
        await db.categories.delete(id)
        await db.items
          .where('categoryIds')
          .equals(id)
          .modify((item) => {
            item.categoryIds = item.categoryIds.filter((c) => c !== id)
          })
        return undefined
      }
      await db.categories.put(toCategory(id, s.data))
      return undefined
    }
    case 'list':
      return applyList(ctx, id, s)
    case 'retired': {
      if (s.del) return undefined
      const r = toRetired(id, s.data)
      await purgeGuestFor(db, r.topic, r.ownerPubkey)
      await db.retiredLists.put(r)
      return undefined
    }
    case 'guest': {
      if (s.del) {
        await db.guestLists.delete(id)
        await deleteCachedTopic(db, id)
        return undefined
      }
      const local = await db.guestLists.get(id)
      const g: GuestList = toGuest(id, s.data, local?.lastOpenedAt)
      if (await isOwnListIdentity(db, { topic: g.topic, ownerPubkey: g.ownerPubkey })) return 'own-list'
      await db.guestLists.put(g)
      return undefined
    }
    case 'profile': {
      const p = toProfile(s.data)
      const put = async (key: string, value: unknown) => {
        if (value === undefined) await db.settings.delete(key)
        else await db.settings.put({ key, value })
      }
      await put('ownerName', p.ownerName)
      await put(LINK_PREVIEW_SETTING_KEY, p.linkPreview)
      await put('relays', p.relays ? sanitizeRelays(p.relays) : undefined)
      if (p.recoverySavedAt !== undefined) await put(RECOVERY_SAVED_SETTING_KEY, p.recoverySavedAt)
      if (p.setupDone && !(await db.settings.get('onboarding'))) {
        await put('onboarding', { status: 'completed', step: 0, answers: {}, updatedAt: ctx.deps.now() })
      }
      return undefined
    }
  }
}

/**
 * A list I own. The sync servers can never swap a list's keys: a record whose keys differ from
 * this device's is applied only as a rotation the account made (this device's topic is in the
 * record's `prev`, or already retired for this list), with the old keys kept as a retired list so
 * the old link is still cut off. Anything else is a conflict: this device's version is kept as a
 * separate list with a new id, so both links keep working and neither set of keys is lost.
 */
async function applyList(ctx: ApplyContext, id: string, s: RecordState): Promise<string | undefined> {
  const { db } = ctx.deps
  const local = await db.sharedLists.get(id)
  if (s.del) {
    if (!local) return undefined
    const topic = topicForSecret(local.listSecret)
    if (!(await db.retiredLists.get(topic))) await db.retiredLists.put(await retiredRecordFor(ctx.deps, local, 'deleted'))
    await db.sharedLists.delete(id)
    return undefined
  }
  const { list, prev } = toList(id, s.data)
  const topic = topicForSecret(list.listSecret)
  await purgeGuestFor(db, topic, publicKeyOf(list.ownerSecretKey))
  const sameKeys = local !== undefined && local.listSecret === list.listSecret && local.ownerSecretKey === list.ownerSecretKey
  if (local && !sameKeys) {
    const localTopic = topicForSecret(local.listSecret)
    const retired: RetiredList | undefined = await db.retiredLists.get(localTopic)
    if (prev.includes(localTopic) || retired?.listId === id) {
      if (!retired) await db.retiredLists.put(await retiredRecordFor(ctx.deps, local, 'rotated'))
    } else {
      await db.sharedLists.put({ ...local, id: randomId() })
    }
  }
  const out: SharedList = { ...list }
  if (sameKeys) {
    if (local.syncPending) out.syncPending = true
    if (local.linkPending) out.linkPending = true
  } else if (out.status !== 'draft') ctx.primeLists.add(id)
  await db.sharedLists.put(out)
  return undefined
}

// ------------------------------------------------------------------ one pass

export type SyncState = 'off' | 'ok' | 'pending' | 'offline' | 'replaced'

export interface SyncOutcome {
  state: SyncState
  /** Something still waits for a relay (or for the first merge): retry with backoff. */
  pending: boolean
  /** Records changed on this device by what came in. */
  applied: number
  /** Events this pass sent and a relay accepted. */
  published: number
}

export interface RunOptions {
  /** 'auto': incremental, full at sign-in and once a day; 'none': local changes only; 'full': everything. */
  fetch?: 'auto' | 'none' | 'full'
  /** Events from a live subscription, instead of fetching. */
  events?: readonly unknown[]
  fetchTimeoutMs?: number
}

function rowFrom(base: { d: string; type: RecordType; id: string }, s: RecordState, extra: Partial<AccountRecordRow> = {}): AccountRecordRow {
  const row: AccountRecordRow = { d: base.d, type: base.type, id: base.id, data: s.data, f: s.f, ...extra }
  if (s.del) row.del = s.del
  return row
}

function stateOf(row: AccountRecordRow): RecordState {
  return row.del ? { data: {}, f: {}, del: row.del } : { data: row.data, f: row.f }
}

const typeRank = (t: string) => {
  const i = (RECORD_TYPES as readonly string[]).indexOf(t)
  return i < 0 ? RECORD_TYPES.length : i
}

interface MergeInput {
  keys: AccountKeys
  device: string
  bySlot: Map<string, AcceptedAccountEvent>
  initial: boolean
  full: boolean
}

/** Step 2 of a pass, in one transaction. Returns how many records changed locally and the lists to prime. */
async function mergePass(deps: Pick<CoreDeps, 'db' | 'now'>, m: MergeInput): Promise<{ applied: number; primeLists: Set<string> }> {
  const { db } = deps
  const ctx: ApplyContext = { deps, primeLists: new Set() }
  let applied = 0
  await db.transaction('rw', tables(db), async () => {
    const now = deps.now()
    const rows = new Map((await db.accountRecords.toArray()).map((r) => [r.d, r]))
    const changed = new Set<string>()

    const scan = async () => {
      const local = await readLocal(db, m.keys, rows)
      for (const [d, l] of local) {
        const row = rows.get(d)
        if (row?.refused) continue
        if (!row && m.initial) {
          const remote = m.bySlot.get(d)?.payload
          if (remote && remote.type !== 'account' && !remote.del) {
            rows.set(d, rowFrom({ d, type: l.type, id: l.id }, initialCandidate(l.data, remote, nextStamp(undefined, now, m.device), m.device), { pending: true }))
            changed.add(d)
            continue
          }
        }
        if (!row && rows.size >= ACCOUNT_MAX_RECORDS) continue
        const prev = row ? stateOf(row) : undefined
        const next = stampChanges(prev, l.data, nextStamp(prev, now, m.device))
        if (!next) continue
        rows.set(d, rowFrom({ d, type: l.type, id: l.id }, next, { ...(row?.createdAt !== undefined ? { createdAt: row.createdAt } : {}), ...(row?.expiresAt !== undefined ? { expiresAt: row.expiresAt } : {}), pending: true }))
        changed.add(d)
      }
      for (const row of rows.values()) {
        if (row.del || row.refused || row.type === 'profile' || local.has(row.d)) continue
        rows.set(row.d, { ...row, data: {}, f: {}, del: nextStamp(stateOf(row), now, m.device), pending: true })
        changed.add(row.d)
      }
    }

    await scan()

    const incoming = [...m.bySlot.values()]
      .filter((a): a is AcceptedAccountEvent & { payload: RecordPayload } => a.payload !== null && a.payload.type !== 'account')
      .sort((a, b) => typeRank(a.payload.type) - typeRank(b.payload.type))
    for (const a of incoming) {
      const p = a.payload
      const row = rows.get(a.d)
      if (!row && rows.size >= ACCOUNT_MAX_RECORDS) continue
      const remote: RecordState = p.del ? deletedState(p.del) : { data: p.data, f: p.f }
      const prev = row ? stateOf(row) : undefined
      let merged = mergeStates(p.type, prev, remote)
      try {
        checkState(p.type, p.id, merged)
      } catch (e) {
        if (!(e instanceof SchemaError)) throw e
        // Fields from two versions that do not fit together: keep the newer version whole.
        merged = latestTime(remote) >= latestTime(prev) ? remote : (prev ?? remote)
      }
      let refused = row?.refused
      if (!sameState(prev, merged) || !row) {
        if (!refused) {
          refused = await applyRecord(ctx, p.type, p.id, merged)
          if (!refused) applied++
        }
      }
      // A replayed older event says nothing about what relays hold now, except in a full fetch,
      // where it is the newest a relay has: then a relay rolled back, and this device sends again.
      const olderEvent = row?.createdAt !== undefined && a.createdAt < row.createdAt
      const pending = olderEvent && !m.full ? Boolean(row?.pending) : !sameState(merged, remote)
      const createdAt = Math.max(row?.createdAt ?? 0, a.createdAt)
      const expiresAt = olderEvent ? row?.expiresAt : a.expiresAt
      rows.set(a.d, rowFrom({ d: a.d, type: p.type, id: p.id }, merged, { createdAt, ...(expiresAt !== undefined ? { expiresAt } : {}), pending, ...(refused ? { refused } : {}) }))
      changed.add(a.d)
    }

    // What the merge changed here (a forked list, a wish taken off a list) is a local change too.
    await scan()

    // Relays lost a record, or it expires soon: send this device's version again.
    for (const row of rows.values()) {
      if (row.pending || row.refused) continue
      const lost = m.full && !m.bySlot.has(row.d)
      const expiring = row.expiresAt !== undefined && row.expiresAt * 1000 - now < REFRESH_BEFORE_EXPIRY * 1000
      const keepTombstone = !row.del || now - row.del[0] < TOMBSTONE_KEEP_MS
      if ((lost || expiring || row.expiresAt === undefined) && keepTombstone) {
        rows.set(row.d, { ...row, pending: true })
        changed.add(row.d)
      }
    }
    await db.accountRecords.bulkPut([...changed].map((d) => rows.get(d)).filter((r): r is AccountRecordRow => r !== undefined))
  })
  return { applied, primeLists: ctx.primeLists }
}

/** Step 3: sends every pending record. Only marks a row sent if it did not change meanwhile. */
async function publishPending(deps: CoreDeps, keys: AccountKeys, transport: Transport): Promise<{ published: number; pending: boolean }> {
  const { db } = deps
  const rows = (await db.accountRecords.toArray()).filter((r) => r.pending && !r.refused).sort((a, b) => typeRank(a.type) - typeRank(b.type))
  let published = 0
  let failed = false
  for (let i = 0; i < rows.length; i += PUBLISH_BATCH) {
    await Promise.all(
      rows.slice(i, i + PUBLISH_BATCH).map(async (row) => {
        const payload: RecordPayload = { v: 1, type: row.type as RecordType, id: row.id, ...stateOf(row) }
        const event = buildRecordEvent(keys, payload, nextCreatedAt(deps.now(), row.createdAt))
        if (!event) {
          failed = true // too large for relays; it stays on this device
          return
        }
        const result = await transport.publish(event)
        await db.transaction('rw', db.accountRecords, async () => {
          const cur = await db.accountRecords.get(row.d)
          if (!cur) return
          const next: AccountRecordRow = { ...cur, createdAt: Math.max(cur.createdAt ?? 0, event.created_at) }
          if (result.ok && sameState(stateOf(cur), stateOf(row))) {
            delete next.pending
            const exp = expirationOf(event)
            if (exp !== undefined) next.expiresAt = exp
          }
          await db.accountRecords.put(next)
        })
        if (result.ok) published++
        else failed = true
      }),
    )
  }
  return { published, pending: failed || (await db.accountRecords.filter((r) => r.pending === true && !r.refused).count()) > 0 }
}

/** One sync pass. Never throws for network trouble; the outcome says what is left to do. */
export async function runAccountSync(deps: CoreDeps, options: RunOptions = {}): Promise<SyncOutcome> {
  const st = await getAccountState(deps.db)
  if (!st || !st.sync) return { state: 'off', pending: false, applied: 0, published: 0 }
  if (st.replacedAt !== undefined) return { state: 'replaced', pending: false, applied: 0, published: 0 }
  const keys = deriveAccountKeys(st.secret)
  const device = await getDeviceId(deps.db)
  const transport = deps.transports(await accountRelays(deps.db))
  const startedAt = deps.now()

  if (st.retiring) await finishRetiring(deps, st)

  let raw: readonly unknown[] = []
  let answered = false
  const mode = options.fetch ?? 'auto'
  const full = !options.events && (mode === 'full' || st.needsMerge === true || (mode === 'auto' && (st.lastFullAt === undefined || startedAt - st.lastFullAt > FULL_FETCH_EVERY_MS)))
  const fetched = !options.events && (mode !== 'none' || st.needsMerge === true)
  if (options.events) {
    raw = options.events
    answered = true
  } else if (fetched) {
    const from = st.cursor ?? (st.lastFullAt !== undefined ? Math.floor(st.lastFullAt / 1000) : undefined)
    const since = full || from === undefined ? undefined : Math.max(0, from - SINCE_MARGIN_S)
    const got = await collectEvents(transport, accountFilter(keys, since), options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS)
    raw = got.events
    answered = got.answered
  }
  // Signed in but not merged yet: nothing is sent until the account's records have been read once.
  if (st.needsMerge && !(answered && full)) return { state: 'offline', pending: true, applied: 0, published: 0 }

  const { bySlot, retired, newest } = newestPerSlot(raw, keys, deps.now())
  if (retired) {
    await updateAccountState(deps.db, st.secret, { replacedAt: deps.now() })
    return { state: 'replaced', pending: false, applied: 0, published: 0 }
  }
  const { applied, primeLists } = await mergePass(deps, { keys, device, bySlot, initial: st.needsMerge === true, full: full && answered })
  const pub = await publishPending(deps, keys, transport)

  const patch: Partial<AccountState> = {}
  const drop: (keyof AccountState)[] = []
  if (newest > (st.cursor ?? 0)) patch.cursor = newest
  if (full && answered) {
    patch.lastFullAt = startedAt
    if (st.needsMerge) drop.push('needsMerge')
  }
  const reached = answered || pub.published > 0
  if (reached && !pub.pending) patch.lastSyncAt = deps.now()
  await updateAccountState(deps.db, st.secret, patch, drop)

  // Lists this device now owns: learn what their owner key already published (no claims).
  for (const id of primeLists) void primeOwnerCache(deps, id).catch(() => undefined)

  const state: SyncState = !reached && (pub.pending || fetched) ? 'offline' : pub.pending ? 'pending' : 'ok'
  return { state, pending: pub.pending || (fetched && !answered), applied, published: pub.published }
}

// ------------------------------------------------------------------ retiring an old account (recovery code change)

/**
 * After a recovery code change: under the old key, a signed marker tells devices still using the
 * old code to stop and sign in again, then every old slot is emptied. Retried until it all lands.
 */
export async function finishRetiring(deps: CoreDeps, st: AccountState): Promise<boolean> {
  if (!st.retiring) return true
  const old = deriveAccountKeys(st.retiring)
  const transport = deps.transports(await accountRelays(deps.db))
  const got = await collectEvents(transport, accountFilter(old), DEFAULT_FETCH_TIMEOUT_MS)
  const createdAt = Math.floor(deps.now() / 1000)
  let newest = createdAt
  const slots = new Set<string>()
  for (const r of got.events) {
    const a = acceptAccountEvent(r, old, deps.now())
    if (!a) continue
    newest = Math.max(newest, a.createdAt + 1)
    if (a.d !== markerSlot(old) && a.payload !== null) slots.add(a.d)
  }
  const marker = buildRecordEvent(old, { v: 1, type: 'account', id: 'status', retiredAt: deps.now() }, newest)
  let ok = marker !== null && (await transport.publish(marker)).ok
  for (const d of slots) {
    if (!(await transport.publish(buildEmptyEvent(old, d, newest))).ok) ok = false
  }
  if (ok && got.answered) await updateAccountState(deps.db, st.secret, {}, ['retiring'])
  return ok
}

// ------------------------------------------------------------------ the running engine

export interface AccountSyncStatus {
  state: SyncState | 'syncing'
  lastSyncAt?: number
}

export interface AccountSyncOptions {
  /** Wait after a local change before sending it (changes are coalesced). */
  debounceMs?: number
  fetchTimeoutMs?: number
  /** Called after a pass that left something unsent, so the app's backoff timer retries. */
  onPending?: () => void
}

const WATCHED = ['items', 'categories', 'sharedLists', 'guestLists', 'retiredLists', 'settings']

/**
 * Runs passes in the background: on `start`, after local changes (coalesced), when a live
 * subscription delivers records, and whenever the app asks (`syncNow`, wired to the app's retry
 * timer: start, online, page visible, backoff). Passes never overlap. Never blocks the interface.
 */
export class AccountSync {
  private readonly deps: CoreDeps
  private readonly options: AccountSyncOptions
  private chain: Promise<unknown> = Promise.resolve()
  private status: AccountSyncStatus = { state: 'off' }
  private readonly listeners = new Set<() => void>()
  private live: { secret: string; stop: Unsubscribe } | null = null
  private buffer: NostrEvent[] = []
  private localTimer: ReturnType<typeof setTimeout> | null = null
  private liveTimer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private readonly onMutated = (parts: Record<string, unknown>) => {
    const prefix = `idb://${this.deps.db.name}/`
    if (Object.keys(parts).some((k) => k.startsWith(prefix) && WATCHED.includes(k.slice(prefix.length).split('/')[0] ?? ''))) this.localChanged()
  }

  constructor(deps: CoreDeps, options: AccountSyncOptions = {}) {
    this.deps = deps
    this.options = options
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getStatus = (): AccountSyncStatus => this.status

  private setStatus(s: AccountSyncStatus): void {
    if (s.state === this.status.state && s.lastSyncAt === this.status.lastSyncAt) return
    this.status = s
    for (const fn of this.listeners) fn()
  }

  start(): void {
    this.stopped = false
    Dexie.on('storagemutated', this.onMutated)
  }

  stop(): void {
    this.stopped = true
    Dexie.on.storagemutated.unsubscribe(this.onMutated)
    this.live?.stop()
    this.live = null
    if (this.localTimer) clearTimeout(this.localTimer)
    if (this.liveTimer) clearTimeout(this.liveTimer)
    this.localTimer = this.liveTimer = null
  }

  /** A local change: send it soon, coalescing changes that come close together. */
  localChanged(): void {
    if (this.stopped || this.localTimer) return
    this.localTimer = setTimeout(() => {
      this.localTimer = null
      void this.enqueue({ fetch: 'none' })
    }, this.options.debounceMs ?? 1500)
  }

  /** One pass with a fetch (incremental, or full when due). The app's retry timer calls this. */
  syncNow(fetch: 'auto' | 'full' = 'auto'): Promise<SyncOutcome> {
    return this.enqueue({ fetch })
  }

  /** Waits for every queued pass (tests). */
  async idle(): Promise<void> {
    for (;;) {
      const c = this.chain
      await c
      if (c === this.chain && !this.localTimer && !this.liveTimer) return
      await new Promise((r) => setTimeout(r, 5))
    }
  }

  private enqueue(options: RunOptions): Promise<SyncOutcome> {
    const run = this.chain.then(async () => {
      if (this.stopped) return { state: 'off', pending: false, applied: 0, published: 0 } satisfies SyncOutcome
      const st = await getAccountState(this.deps.db)
      this.setStatus({ state: 'syncing', ...(st?.lastSyncAt !== undefined ? { lastSyncAt: st.lastSyncAt } : {}) })
      let out: SyncOutcome
      try {
        out = await runAccountSync(this.deps, { ...options, ...(this.options.fetchTimeoutMs !== undefined ? { fetchTimeoutMs: this.options.fetchTimeoutMs } : {}) })
      } catch {
        out = { state: 'pending', pending: true, applied: 0, published: 0 }
      }
      const after = await getAccountState(this.deps.db)
      this.setStatus({ state: out.state, ...(after?.lastSyncAt !== undefined ? { lastSyncAt: after.lastSyncAt } : {}) })
      await this.ensureLive(after, out.state)
      if (out.pending) this.options.onPending?.()
      return out
    })
    this.chain = run.catch(() => undefined)
    return run
  }

  /** Keeps one live subscription for the signed-in account (after the first merge), none otherwise. */
  private async ensureLive(st: AccountState | undefined, state: SyncState): Promise<void> {
    const want = !this.stopped && st && st.sync && !st.needsMerge && state !== 'replaced' && state !== 'off' ? st.secret : null
    if (this.live && this.live.secret === want) return
    this.live?.stop()
    this.live = null
    if (!want) return
    const keys = deriveAccountKeys(want)
    const transport = this.deps.transports(await accountRelays(this.deps.db))
    const since = Math.max(0, Math.floor(this.deps.now() / 1000) - SINCE_MARGIN_S)
    const stop = transport.subscribe(accountFilter(keys, since), (e) => {
      if (this.buffer.length >= 1000) return
      this.buffer.push(e)
      if (this.liveTimer) return
      this.liveTimer = setTimeout(() => {
        this.liveTimer = null
        const events = this.buffer
        this.buffer = []
        void this.enqueue({ events })
      }, 250)
    })
    this.live = { secret: want, stop }
  }
}
