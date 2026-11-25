// Account records, PROTOCOL.md section 12: what syncs, how a local row becomes a record, how two
// versions merge, and the events that carry them. Pure: no database, no network.
//
// A record is one wish, category, list I own, retired list, list shared with me, or the profile.
// Its state is a set of fields, each with a stamp [ms, device]. Two states merge field by field:
// the newer stamp wins, ties broken by the device id. A deleted record has no fields and a
// deletion stamp, and deletion is final. This merge is commutative, associative and idempotent,
// so every device that has seen the same versions holds the same state, whatever the order.

import { finalizeEvent, verifyEvent } from 'nostr-tools/pure'
import type { NostrEvent } from 'nostr-tools/core'
import { decryptJson, encryptJson } from '../crypto/aead.ts'
import { hexToBytes } from '../crypto/bytes.ts'
import { topicForSecret } from '../crypto/keys.ts'
import type { Stamp } from '../db/schema.ts'
import { codePointLength, isHex, isObject, readArray, readHex, SchemaError } from '../model/guards.ts'
import { LIMITS } from '../model/limits.ts'
import type { Category, GuestList, Item, RetiredList, SharedList } from '../model/types.ts'
import { parseCategory, parseGuestList, parseItem, parseRetiredList, parseSharedList, readRelayList } from '../model/validate.ts'
import { expirationFor, expirationOf, isExpired } from '../protocol/build.ts'
import { sanitizeEvent } from '../protocol/receive.ts'
import { HIPPO_KIND } from '../protocol/slots.ts'
import { stableStringify } from '../services/util.ts'
import { recordSlotId, type AccountKeys } from './keys.ts'

export type { Stamp }

export type RecordType = 'wish' | 'category' | 'list' | 'retired' | 'guest' | 'profile'

/** The order a batch is applied in: retired lists before lists, lists before wishes. */
export const RECORD_TYPES: readonly RecordType[] = ['profile', 'retired', 'list', 'category', 'wish', 'guest']

export const PROFILE_ID = 'profile'

/** Fields each type may carry. Anything else in a payload rejects it. */
export const RECORD_FIELDS: Record<RecordType, readonly string[]> = {
  wish: ['title', 'url', 'imageUrl', 'price', 'quantity', 'importance', 'notes', 'categoryIds', 'allowContributions', 'createdAt', 'updatedAt', 'archivedAt'],
  category: ['name', 'emoji', 'order'],
  list: ['name', 'message', 'eventDate', 'itemIds', 'showPrices', 'showNotes', 'keys', 'relays', 'status', 'createdAt', 'updatedAt', 'publishedAt', 'prev'],
  retired: ['ownerPubkey', 'listId', 'reason', 'retiredAt', 'pending'],
  guest: ['ownerPubkey', 'listSecret', 'relays', 'identity', 'nickname', 'hiddenAt', 'claimTitles'],
  profile: ['ownerName', 'linkPreview', 'relays', 'setupDone', 'recoverySavedAt'],
}

/** Largest number of records an account holds; new slots beyond it are ignored. */
export const ACCOUNT_MAX_RECORDS = 30_000
/** How far ahead of this device's corrected clock a stamp may be. */
export const STAMP_FUTURE_MS = 24 * 60 * 60 * 1000
const MAX_PREV = 200

export interface RecordState {
  data: Record<string, unknown>
  f: Record<string, Stamp>
  del?: Stamp
}

export interface RecordPayload extends RecordState {
  v: 1
  type: RecordType
  id: string
}

/** Published under the old key when the recovery code changes: devices still on it stop and ask to sign in again. */
export interface MarkerPayload {
  v: 1
  type: 'account'
  id: 'status'
  retiredAt: number
}

export interface Profile {
  ownerName?: string
  linkPreview?: true
  relays?: string[]
  /** Setup was finished on some device; once true it stays true. */
  setupDone?: true
  /** When the person confirmed they saved the recovery code. */
  recoverySavedAt?: number
}

// ------------------------------------------------------------------ stamps

export function cmpStamp(a: Stamp | undefined, b: Stamp | undefined): number {
  if (!a) return b ? -1 : 0
  if (!b) return 1
  if (a[0] !== b[0]) return a[0] - b[0]
  return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0
}

/** The newest stamp in a state (0 for none). */
export function latestTime(s: RecordState | undefined): number {
  if (!s) return 0
  let t = s.del?.[0] ?? 0
  for (const st of Object.values(s.f)) t = Math.max(t, st[0])
  return t
}

/** A stamp for a local write: never older than what the record already holds, so a later edit always wins here. */
export function nextStamp(prev: RecordState | undefined, now: number, device: string): Stamp {
  return [Math.max(now, latestTime(prev) + 1), device]
}

function isStamp(v: unknown, maxMs: number): v is Stamp {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && Number.isSafeInteger(v[0]) && v[0] >= 0 && v[0] <= maxMs && isHex(v[1], 16)
}

// ------------------------------------------------------------------ state

/** Drops undefined values and copies, so equal records compare equal. */
function clean(o: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(o)) as Record<string, unknown>
}

export function stateKey(s: RecordState): string {
  return stableStringify({ data: s.data, f: s.f, del: s.del ?? null })
}

export function sameState(a: RecordState | undefined, b: RecordState | undefined): boolean {
  if (!a || !b) return a === b
  return stateKey(a) === stateKey(b)
}

/**
 * Stamps the fields of `data` that differ from `prev` with `stamp`; `null` when nothing changed.
 * A field that lost its value keeps a stamp with no value, so the removal syncs too.
 */
export function stampChanges(prev: RecordState | undefined, data: Record<string, unknown>, stamp: Stamp): RecordState | null {
  const next = clean(data)
  if (prev && !prev.del) {
    const f = { ...prev.f }
    let changed = false
    for (const k of new Set([...Object.keys(prev.data), ...Object.keys(next)])) {
      if (stableStringify(prev.data[k]) !== stableStringify(next[k])) {
        f[k] = stamp
        changed = true
      }
    }
    return changed ? { data: next, f } : null
  }
  if (prev?.del) return null // deletion is final
  const f: Record<string, Stamp> = {}
  for (const k of Object.keys(next)) f[k] = stamp
  return { data: next, f }
}

export function deletedState(stamp: Stamp): RecordState {
  return { data: {}, f: {}, del: stamp }
}

function pickIdentity(a: unknown, b: unknown): boolean {
  // true: keep a. The earliest guest identity wins, so every device keeps the same key.
  if (!isObject(a)) return false
  if (!isObject(b)) return true
  const ta = typeof a.addedAt === 'number' ? a.addedAt : Infinity
  const tb = typeof b.addedAt === 'number' ? b.addedAt : Infinity
  if (ta !== tb) return ta < tb
  return String(a.guestSecretKey) <= String(b.guestSecretKey)
}

/** Field-wise last-writer-wins; deletion wins over everything. Deterministic for any two inputs. */
export function mergeStates(type: RecordType, a: RecordState | undefined, b: RecordState): RecordState {
  if (!a) return b
  if (a.del || b.del) return deletedState((cmpStamp(a.del, b.del) >= 0 ? a.del : b.del) as Stamp)
  const data: Record<string, unknown> = {}
  const f: Record<string, Stamp> = {}
  for (const k of new Set([...Object.keys(a.f), ...Object.keys(b.f)])) {
    const sa = a.f[k]
    const sb = b.f[k]
    let fromA: boolean
    if (type === 'guest' && k === 'identity' && sa && sb) fromA = pickIdentity(a.data[k], b.data[k])
    else {
      const c = cmpStamp(sa, sb)
      fromA = c > 0 || (c === 0 && stableStringify(a.data[k]) >= stableStringify(b.data[k]))
    }
    const src = fromA ? a : b
    const st = fromA ? sa : sb
    if (st) f[k] = st
    if (src.data[k] !== undefined) data[k] = src.data[k]
  }
  return { data, f }
}

// ------------------------------------------------------------------ local rows to records

export function projectItem(item: Item): Record<string, unknown> {
  const { id: _id, ...rest } = item
  return clean(rest)
}

export function projectCategory(c: Category): Record<string, unknown> {
  const { id: _id, ...rest } = c
  return clean(rest)
}

/** `prev` lists the topics this list was rotated away from, so another device can tell a rotation from a conflict. */
export function projectList(list: SharedList, rotatedTopics: readonly string[]): Record<string, unknown> {
  const { id: _id, syncPending: _s, linkPending: _l, ownerSecretKey, listSecret, ...rest } = list
  const out: Record<string, unknown> = { ...rest, keys: { ownerSecretKey, listSecret } }
  if (rotatedTopics.length > 0) out.prev = [...rotatedTopics].sort().slice(0, MAX_PREV)
  return clean(out)
}

export function projectRetired(r: RetiredList): Record<string, unknown> {
  const { topic: _t, ...rest } = r
  return clean(rest)
}

/** `lastOpenedAt` stays on the device; the guest key and when it was made travel together. */
export function projectGuest(g: GuestList): Record<string, unknown> {
  const { topic: _t, lastOpenedAt: _o, guestSecretKey, addedAt, ...rest } = g
  return clean({ ...rest, identity: { guestSecretKey, addedAt } })
}

export function projectProfile(p: Profile): Record<string, unknown> {
  return clean({ ...p })
}

// ------------------------------------------------------------------ records to local rows (validation)

function readIdFor(type: RecordType, id: unknown): string {
  if (type === 'profile') {
    if (id !== PROFILE_ID) throw new SchemaError('id', 'expected profile')
    return id
  }
  return readHex(id, 'id', type === 'retired' || type === 'guest' ? 32 : 16)
}

export function toItem(id: string, data: Record<string, unknown>): Item {
  return parseItem({ ...data, id }, 'wish')
}

export function toCategory(id: string, data: Record<string, unknown>): Category {
  return parseCategory({ ...data, id }, 'category')
}

export interface ListRecord {
  list: SharedList
  prev: string[]
}

export function toList(id: string, data: Record<string, unknown>): ListRecord {
  const { keys, prev, ...rest } = data
  if (!isObject(keys)) throw new SchemaError('list.keys', 'expected keys')
  const list = parseSharedList({ ...rest, id, ownerSecretKey: keys.ownerSecretKey, listSecret: keys.listSecret }, 'list')
  const topics = prev === undefined ? [] : readArray(prev, 'list.prev', MAX_PREV).map((t, i) => readHex(t, `list.prev[${i}]`, 32))
  return { list, prev: topics }
}

export function toRetired(id: string, data: Record<string, unknown>): RetiredList {
  return parseRetiredList({ ...data, topic: id }, 'retired')
}

export function toGuest(id: string, data: Record<string, unknown>, lastOpenedAt?: number): GuestList {
  const { identity, ...rest } = data
  if (!isObject(identity)) throw new SchemaError('guest.identity', 'expected an identity')
  const addedAt = identity.addedAt
  return parseGuestList(
    { ...rest, topic: id, guestSecretKey: identity.guestSecretKey, addedAt, lastOpenedAt: lastOpenedAt ?? addedAt },
    'guest',
  )
}

export function toProfile(data: Record<string, unknown>): Profile {
  const out: Profile = {}
  const { ownerName, linkPreview, relays, setupDone, recoverySavedAt } = data
  if (ownerName !== undefined) {
    if (typeof ownerName !== 'string' || ownerName.trim() === '' || codePointLength(ownerName) > LIMITS.ownerName) throw new SchemaError('profile.ownerName', 'invalid')
    out.ownerName = ownerName
  }
  if (linkPreview !== undefined) {
    if (linkPreview !== true) throw new SchemaError('profile.linkPreview', 'expected true')
    out.linkPreview = true
  }
  if (relays !== undefined) out.relays = readRelayList(relays, 'profile.relays')
  if (setupDone !== undefined) {
    if (setupDone !== true) throw new SchemaError('profile.setupDone', 'expected true')
    out.setupDone = true
  }
  if (recoverySavedAt !== undefined) {
    if (typeof recoverySavedAt !== 'number' || !Number.isSafeInteger(recoverySavedAt) || recoverySavedAt < 0) throw new SchemaError('profile.recoverySavedAt', 'invalid')
    out.recoverySavedAt = recoverySavedAt
  }
  return out
}

/** Throws SchemaError when the state is not a valid record of its type (the same checks as a backup import). */
export function checkState(type: RecordType, id: string, s: RecordState): void {
  if (s.del) {
    if (Object.keys(s.data).length > 0 || Object.keys(s.f).length > 0) throw new SchemaError('record', 'a deleted record has no fields')
    return
  }
  switch (type) {
    case 'wish':
      toItem(id, s.data)
      return
    case 'category':
      toCategory(id, s.data)
      return
    case 'list': {
      const { list, prev } = toList(id, s.data)
      if (prev.includes(topicForSecret(list.listSecret))) throw new SchemaError('list.prev', 'holds the current topic')
      return
    }
    case 'retired':
      toRetired(id, s.data)
      return
    case 'guest':
      toGuest(id, s.data)
      return
    case 'profile':
      toProfile(s.data)
      return
  }
}

/** Validates a decrypted payload; null when anything is wrong. Unknown fields reject the record. */
export function parseRecordPayload(value: unknown, now: number): RecordPayload | MarkerPayload | null {
  if (!isObject(value) || value.v !== 1) return null
  if (value.type === 'account') {
    const at = value.retiredAt
    if (value.id !== 'status' || typeof at !== 'number' || !Number.isSafeInteger(at) || at < 0) return null
    return { v: 1, type: 'account', id: 'status', retiredAt: at }
  }
  const type = value.type
  if (typeof type !== 'string' || !(RECORD_TYPES as readonly string[]).includes(type)) return null
  const t = type as RecordType
  try {
    const id = readIdFor(t, value.id)
    const maxMs = now + STAMP_FUTURE_MS
    if (!isObject(value.data) || !isObject(value.f)) return null
    const allowed = RECORD_FIELDS[t]
    const f: Record<string, Stamp> = {}
    for (const [k, st] of Object.entries(value.f)) {
      if (!allowed.includes(k) || !isStamp(st, maxMs)) return null
      f[k] = [st[0], st[1]]
    }
    for (const k of Object.keys(value.data)) if (!(k in f)) return null
    const state: RecordState = { data: clean(value.data), f }
    if (value.del !== undefined) {
      if (!isStamp(value.del, maxMs)) return null
      state.del = [value.del[0], value.del[1]]
    }
    checkState(t, id, state)
    return { v: 1, type: t, id, ...state }
  } catch (e) {
    if (e instanceof SchemaError) return null
    throw e
  }
}

// ------------------------------------------------------------------ events

export const ACCOUNT_SLOT_PREFIX = 'hippo-acct:'

export function accountSlot(keys: Pick<AccountKeys, 'topic' | 'slotKey'>, type: RecordType | 'account', id: string): string {
  return `${ACCOUNT_SLOT_PREFIX}${keys.topic}:${recordSlotId(keys.slotKey, type, id)}`
}

export function markerSlot(keys: Pick<AccountKeys, 'topic' | 'slotKey'>): string {
  return accountSlot(keys, 'account', 'status')
}

function slotRe(topic: string): RegExp {
  return new RegExp(`^${ACCOUNT_SLOT_PREFIX}${topic}:[0-9a-f]{32}$`)
}

function sign(keys: AccountKeys, d: string, content: string, createdAt: number): NostrEvent {
  return finalizeEvent(
    {
      kind: HIPPO_KIND,
      created_at: createdAt,
      tags: [
        ['d', d],
        ['t', keys.topic],
        ['expiration', String(expirationFor(createdAt))],
      ],
      content,
    },
    hexToBytes(keys.secretKey),
  )
}

/** The signed event for a record, or null when it would be larger than relays accept. */
export function buildRecordEvent(keys: AccountKeys, payload: RecordPayload | MarkerPayload, createdAt: number): NostrEvent | null {
  const d = accountSlot(keys, payload.type, payload.id)
  const content = encryptJson(keys.contentKey, payload, d)
  if (content.length > LIMITS.content) return null
  return sign(keys, d, content, createdAt)
}

/** An empty event over a slot: what replaces every record of a retired account on the sync servers. */
export function buildEmptyEvent(keys: AccountKeys, d: string, createdAt: number): NostrEvent {
  return sign(keys, d, '', createdAt)
}

export interface AcceptedAccountEvent {
  d: string
  id: string
  createdAt: number
  expiresAt?: number
  /** null: an emptied slot (the account was retired, or the event carries nothing). */
  payload: RecordPayload | MarkerPayload | null
}

/**
 * Everything received is hostile until this passes: NIP-01 shape on a fresh copy, kind 30078, the
 * account's key, exactly one `t` equal to the account topic and one `d` of the account's slot
 * shape, at most one unexpired `expiration`, content within limits, a valid signature, decryption
 * with the slot as associated data, a payload that validates, and a slot that matches the
 * payload's own type and id (so a record cannot be moved to another slot).
 */
export function acceptAccountEvent(raw: unknown, keys: AccountKeys, now: number): AcceptedAccountEvent | null {
  const event = sanitizeEvent(raw)
  if (!event || event.kind !== HIPPO_KIND || event.pubkey !== keys.pubkey) return null
  const t = event.tags.filter((x) => x[0] === 't')
  const ds = event.tags.filter((x) => x[0] === 'd')
  if (t.length !== 1 || t[0]?.[1] !== keys.topic || ds.length !== 1) return null
  const d = ds[0]?.[1] ?? ''
  if (!slotRe(keys.topic).test(d)) return null
  if (event.tags.filter((x) => x[0] === 'expiration').length > 1 || isExpired(event, now)) return null
  if (event.content.length > LIMITS.content) return null
  if (!verifyEvent(event)) return null
  const exp = expirationOf(event)
  const base = { d, id: event.id, createdAt: event.created_at, ...(exp !== undefined ? { expiresAt: exp } : {}) }
  if (event.content === '') return { ...base, payload: null }
  const payload = parseRecordPayload(decryptJson(keys.contentKey, event.content, d), now)
  if (!payload || accountSlot(keys, payload.type, payload.id) !== d) return null
  return { ...base, payload }
}
