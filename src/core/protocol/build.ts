// Building and signing the three event types, PROTOCOL.md section 4.

import { finalizeEvent } from 'nostr-tools/pure'
import type { NostrEvent } from 'nostr-tools/core'
import { encryptJson } from '../crypto/aead.ts'
import { hexToBytes } from '../crypto/bytes.ts'
import type { ClaimPayload, ItemPayload, ListMetaPayload } from '../model/types.ts'
import { HIPPO_KIND, claimSlot, itemSlot, metaSlot } from './slots.ts'

const DAY = 86_400
/** Expiration never lands sooner than this, so a list with a long-past event date stays publishable. */
const MIN_LIFETIME = 30 * DAY

/**
 * NIP-40 expiration: event date + 180 days, or created + 400 days without an
 * event date. Clamped to at least created + 30 days (see report: an event date
 * far in the past would otherwise produce an already-expired event).
 */
export function expirationFor(createdAt: number, eventDate?: string): number {
  if (eventDate) {
    const ms = Date.parse(`${eventDate}T00:00:00Z`)
    if (Number.isFinite(ms)) return Math.max(Math.floor(ms / 1000) + 180 * DAY, createdAt + MIN_LIFETIME)
  }
  return createdAt + 400 * DAY
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
  eventDate?: string
}

function sign(d: string, content: string, o: SignOptions): NostrEvent {
  return finalizeEvent(
    {
      kind: HIPPO_KIND,
      created_at: o.createdAt,
      tags: [
        ['d', d],
        ['t', o.topic],
        ['expiration', String(expirationFor(o.createdAt, o.eventDate))],
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

export function buildItemEvent(payload: ItemPayload, contentKey: Uint8Array, o: SignOptions): NostrEvent {
  const d = itemSlot(o.topic, payload.id)
  return sign(d, encryptJson(contentKey, payload, d), o)
}

/** An empty-content item event that replaces the item in its slot (unpublish, rotation). */
export function buildItemTombstone(itemId: string, o: SignOptions): NostrEvent {
  return sign(itemSlot(o.topic, itemId), '', o)
}

export function buildClaimEvent(payload: ClaimPayload, claimsKey: Uint8Array, o: SignOptions): NostrEvent {
  const d = claimSlot(o.topic, payload.id)
  return sign(d, encryptJson(claimsKey, payload, d), o)
}
