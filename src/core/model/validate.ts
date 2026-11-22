// Runtime schema validation for every payload that crosses a trust boundary:
// decrypted network payloads and imported backups. Validators return a fresh
// object containing only known fields so hostile extras never flow onward.

import { LIMITS } from './limits.ts'
import {
  SchemaError,
  readArray,
  readBoolean,
  readEnum,
  readHex,
  readId,
  readIdList,
  readInt,
  readObject,
  readOptionalDate,
  readOptionalHttpUrl,
  readOptionalInt,
  readOptionalString,
  readString,
  readTimestamp,
} from './guards.ts'
import type {
  Category,
  ClaimPayload,
  GuestList,
  Item,
  ItemPayload,
  ListMetaPayload,
  Money,
  SharedList,
} from './types.ts'
import { IMPORTANCE_LEVELS } from './types.ts'

const CURRENCY_RE = /^[A-Z]{3}$/

export function readMoney(value: unknown, path: string, minAmount = 0): Money {
  const o = readObject(value, path)
  const amount = readInt(o.amount, `${path}.amount`, minAmount, LIMITS.amount)
  if (typeof o.currency !== 'string' || !CURRENCY_RE.test(o.currency)) {
    throw new SchemaError(`${path}.currency`, 'expected an ISO 4217 code')
  }
  return { amount, currency: o.currency }
}

function readVersion(value: unknown, path: string): 1 {
  if (value !== 1) throw new SchemaError(path, 'unsupported version')
  return 1
}

function assign<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value
}

export function parseListMetaPayload(value: unknown): ListMetaPayload {
  const o = readObject(value, 'meta')
  const out: ListMetaPayload = {
    v: readVersion(o.v, 'meta.v'),
    name: readString(o.name, 'meta.name', LIMITS.name),
    itemIds: readIdList(o.itemIds, 'meta.itemIds', LIMITS.itemIds),
    showPrices: readBoolean(o.showPrices, 'meta.showPrices'),
    showNotes: readBoolean(o.showNotes, 'meta.showNotes'),
    status: readEnum(o.status, 'meta.status', ['published', 'unpublished'] as const),
    updatedAt: readTimestamp(o.updatedAt, 'meta.updatedAt'),
  }
  assign(out, 'message', readOptionalString(o.message, 'meta.message', LIMITS.message))
  assign(out, 'eventDate', readOptionalDate(o.eventDate, 'meta.eventDate'))
  assign(out, 'movedTo', readOptionalString(o.movedTo, 'meta.movedTo', LIMITS.movedTo))
  return out
}

export function parseItemPayload(value: unknown): ItemPayload {
  const o = readObject(value, 'item')
  const out: ItemPayload = {
    v: readVersion(o.v, 'item.v'),
    id: readId(o.id, 'item.id'),
    title: readString(o.title, 'item.title', LIMITS.title, 1),
    quantity: readInt(o.quantity, 'item.quantity', 1, LIMITS.quantity),
    importance: readEnum(o.importance, 'item.importance', IMPORTANCE_LEVELS),
    allowContributions: readBoolean(o.allowContributions, 'item.allowContributions'),
    updatedAt: readTimestamp(o.updatedAt, 'item.updatedAt'),
  }
  assign(out, 'url', readOptionalHttpUrl(o.url, 'item.url', LIMITS.url))
  assign(out, 'imageUrl', readOptionalHttpUrl(o.imageUrl, 'item.imageUrl', LIMITS.url))
  if (o.price !== undefined) out.price = readMoney(o.price, 'item.price')
  assign(out, 'notes', readOptionalString(o.notes, 'item.notes', LIMITS.notes))
  return out
}

export function parseClaimPayload(value: unknown): ClaimPayload {
  const o = readObject(value, 'claim')
  const kind = readEnum(o.kind, 'claim.kind', ['full', 'pledge'] as const)
  const out: ClaimPayload = {
    v: readVersion(o.v, 'claim.v'),
    id: readId(o.id, 'claim.id'),
    itemId: readId(o.itemId, 'claim.itemId'),
    kind,
    status: readEnum(o.status, 'claim.status', ['reserved', 'purchased', 'withdrawn'] as const),
    createdAt: readTimestamp(o.createdAt, 'claim.createdAt'),
    updatedAt: readTimestamp(o.updatedAt, 'claim.updatedAt'),
  }
  if (kind === 'full') {
    if (o.amount !== undefined) throw new SchemaError('claim.amount', 'not allowed on a full claim')
    assign(out, 'quantity', readOptionalInt(o.quantity, 'claim.quantity', 1, LIMITS.quantity))
  } else {
    if (o.quantity !== undefined) throw new SchemaError('claim.quantity', 'not allowed on a pledge')
    out.amount = readMoney(o.amount, 'claim.amount', 1)
  }
  assign(out, 'nickname', readOptionalString(o.nickname, 'claim.nickname', LIMITS.nickname))
  return out
}

// ---- Local records (used when importing a backup) ----

export function parseItem(value: unknown, path = 'item'): Item {
  const o = readObject(value, path)
  const out: Item = {
    id: readId(o.id, `${path}.id`),
    title: readString(o.title, `${path}.title`, LIMITS.title, 1),
    quantity: readInt(o.quantity, `${path}.quantity`, 1, LIMITS.quantity),
    importance: readEnum(o.importance, `${path}.importance`, IMPORTANCE_LEVELS),
    categoryIds: readIdList(o.categoryIds, `${path}.categoryIds`, 1000),
    allowContributions: readBoolean(o.allowContributions, `${path}.allowContributions`),
    createdAt: readTimestamp(o.createdAt, `${path}.createdAt`),
    updatedAt: readTimestamp(o.updatedAt, `${path}.updatedAt`),
  }
  // Local URLs are kept verbatim (the owner typed them); rendering still checks the scheme.
  assign(out, 'url', readOptionalString(o.url, `${path}.url`, LIMITS.url))
  assign(out, 'imageUrl', readOptionalString(o.imageUrl, `${path}.imageUrl`, LIMITS.url))
  if (o.price !== undefined) out.price = readMoney(o.price, `${path}.price`)
  assign(out, 'notes', readOptionalString(o.notes, `${path}.notes`, LIMITS.notes))
  assign(out, 'archivedAt', o.archivedAt === undefined ? undefined : readTimestamp(o.archivedAt, `${path}.archivedAt`))
  return out
}

export function parseCategory(value: unknown, path = 'category'): Category {
  const o = readObject(value, path)
  const out: Category = {
    id: readId(o.id, `${path}.id`),
    name: readString(o.name, `${path}.name`, LIMITS.categoryName, 1),
    order: readInt(o.order, `${path}.order`, -1_000_000, 1_000_000),
  }
  assign(out, 'emoji', readOptionalString(o.emoji, `${path}.emoji`, LIMITS.emoji))
  return out
}

export function readRelayList(value: unknown, path: string): string[] {
  const arr = readArray(value, path, LIMITS.relays)
  return arr.map((v, i) => {
    const s = readString(v, `${path}[${i}]`, LIMITS.relayUrl, 1)
    if (!isRelayUrl(s)) throw new SchemaError(`${path}[${i}]`, 'not a relay URL')
    return s
  })
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** wss:// anywhere; plain ws:// only for loopback (local mock relay in tests). */
export function isRelayUrl(value: string): boolean {
  if (value.includes(',') || /\s/.test(value)) return false
  try {
    const u = new URL(value)
    if (u.username || u.password) return false
    if (u.protocol === 'wss:') return u.hostname.length > 0
    if (u.protocol === 'ws:') return LOCAL_HOSTS.has(u.hostname)
    return false
  } catch {
    return false
  }
}

export function parseSharedList(value: unknown, path = 'sharedList'): SharedList {
  const o = readObject(value, path)
  const out: SharedList = {
    id: readId(o.id, `${path}.id`),
    name: readString(o.name, `${path}.name`, LIMITS.name, 1),
    itemIds: readIdList(o.itemIds, `${path}.itemIds`, LIMITS.itemIds),
    showPrices: readBoolean(o.showPrices, `${path}.showPrices`),
    showNotes: readBoolean(o.showNotes, `${path}.showNotes`),
    ownerSecretKey: readHex(o.ownerSecretKey, `${path}.ownerSecretKey`, 32),
    listSecret: readHex(o.listSecret, `${path}.listSecret`, 32),
    relays: readRelayList(o.relays, `${path}.relays`),
    status: readEnum(o.status, `${path}.status`, ['draft', 'published', 'unpublished'] as const),
    createdAt: readTimestamp(o.createdAt, `${path}.createdAt`),
    updatedAt: readTimestamp(o.updatedAt, `${path}.updatedAt`),
  }
  assign(out, 'message', readOptionalString(o.message, `${path}.message`, LIMITS.message))
  assign(out, 'eventDate', readOptionalDate(o.eventDate, `${path}.eventDate`))
  assign(out, 'publishedAt', o.publishedAt === undefined ? undefined : readTimestamp(o.publishedAt, `${path}.publishedAt`))
  return out
}

export function parseGuestList(value: unknown, path = 'guestList'): GuestList {
  const o = readObject(value, path)
  const out: GuestList = {
    topic: readHex(o.topic, `${path}.topic`, 32),
    ownerPubkey: readHex(o.ownerPubkey, `${path}.ownerPubkey`, 32),
    listSecret: readHex(o.listSecret, `${path}.listSecret`, 32),
    relays: readRelayList(o.relays, `${path}.relays`),
    guestSecretKey: readHex(o.guestSecretKey, `${path}.guestSecretKey`, 32),
    addedAt: readTimestamp(o.addedAt, `${path}.addedAt`),
    lastOpenedAt: readTimestamp(o.lastOpenedAt, `${path}.lastOpenedAt`),
  }
  assign(out, 'nickname', readOptionalString(o.nickname, `${path}.nickname`, LIMITS.nickname))
  return out
}

/** Converts a thrown SchemaError into `null` for callers that only need accept/reject. */
export function tryParse<T>(parse: (v: unknown) => T, value: unknown): T | null {
  try {
    return parse(value)
  } catch (e) {
    if (e instanceof SchemaError) return null
    throw e
  }
}
