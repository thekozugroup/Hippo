// Building and signing the three event types, PROTOCOL.md section 4.

import { finalizeEvent } from 'nostr-tools/pure'
import type { NostrEvent } from 'nostr-tools/core'
import { encryptJson } from '../crypto/aead.ts'
import { hexToBytes, randomBytes } from '../crypto/bytes.ts'
import type { ClaimPayload, ItemPayload, ListMetaPayload } from '../model/types.ts'
import { HIPPO_KIND, claimSlot, itemSlot, metaSlot } from './slots.ts'

export const DAY = 86_400
const LIFETIME_DAYS = 400
const JITTER_DAYS = 30
/** Own events whose expiration is closer than this are re-signed by sync and repair. */
export const REFRESH_BEFORE_EXPIRY = 60 * DAY

/** Uniform integer in 0..max from the CSPRNG. */
function randomInt(max: number): number {
  const limit = 256 - (256 % (max + 1))
  for (;;) {
    const b = randomBytes(1)[0] ?? 0
    if (b < limit) return b % (max + 1)
  }
}

/**
 * NIP-40 expiration: created + 400 days, rounded up to 00:00 UTC on the
 * first of the next month, plus 0 to 30 random whole days. It depends on
 * nothing in the list, so the tag reveals neither the event date nor the
 * exact creation time.
 */
export function expirationFor(createdAt: number, jitterDays: number = randomInt(JITTER_DAYS)): number {
  const t = new Date((createdAt + LIFETIME_DAYS * DAY) * 1000)
  const firstOfNextMonth = Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1) / 1000
  return firstOfNextMonth + jitterDays * DAY
}

/** The event's NIP-40 expiration in unix seconds; `undefined` when absent, repeated or unreadable. */
export function expirationOf(event: Pick<NostrEvent, 'tags'>): number | undefined {
  const found = event.tags.filter((t) => t[0] === 'expiration')
  if (found.length !== 1) return undefined
  const v = found[0]?.[1]
  if (v === undefined || !/^\d{1,15}$/.test(v)) return undefined
  return Number(v)
}

/** True when the event has expired at `nowMs`. */
export function isExpired(event: Pick<NostrEvent, 'tags'>, nowMs: number): boolean {
  const exp = expirationOf(event)
  return exp !== undefined && exp <= Math.floor(nowMs / 1000)
}

/** True when an own event should be re-signed so it does not lapse (PROTOCOL.md section 8). */
export function expiresSoon(event: Pick<NostrEvent, 'tags'>, nowMs: number): boolean {
  const exp = expirationOf(event)
  return exp !== undefined && exp - Math.floor(nowMs / 1000) < REFRESH_BEFORE_EXPIRY
}

/**
 * Seconds for a replacement event. Strictly greater than the previous
 * version so two edits in the same second never tie (a tie is broken by
 * event id, which is random, and could resurrect the older edit).
 */
export function nextCreatedAt(nowMs: number, previous?: number): number {
  const now = Math.floor(nowMs / 1000)
  return previous === undefined ? now : Math.max(now, previous + 1)
}

export interface SignOptions {
  topic: string
  secretKey: string
  createdAt: number
}

function sign(d: string, content: string, o: SignOptions): NostrEvent {
  return finalizeEvent(
    {
      kind: HIPPO_KIND,
      created_at: o.createdAt,
      tags: [
        ['d', d],
        ['t', o.topic],
        ['expiration', String(expirationFor(o.createdAt))],
      ],
      content,
    },
    hexToBytes(o.secretKey),
  )
}

export function buildMetaEvent(payload: ListMetaPayload, contentKey: Uint8Array, o: SignOptions): NostrEvent {
  const d = metaSlot(o.topic)
  return sign(d, encryptJson(contentKey, payload, d), o)
}

/** `payload.id` is the shared (derived) item id, never the local wishlist id. */
export function buildItemEvent(payload: ItemPayload, contentKey: Uint8Array, o: SignOptions): NostrEvent {
  const d = itemSlot(o.topic, payload.id)
  return sign(d, encryptJson(contentKey, payload, d), o)
}

/** An empty-content item event that replaces the item in its slot (unpublish, rotation, delete). */
export function buildItemTombstone(sharedItemId: string, o: SignOptions): NostrEvent {
  return sign(itemSlot(o.topic, sharedItemId), '', o)
}

export function buildClaimEvent(payload: ClaimPayload, claimsKey: Uint8Array, o: SignOptions): NostrEvent {
  const d = claimSlot(o.topic, payload.id)
  return sign(d, encryptJson(claimsKey, payload, d), o)
}
