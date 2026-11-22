// Verify, classify and decrypt one incoming event, PROTOCOL.md section 5
// rules 1-4 and 6. Slot ownership (rule 5) and last-writer-wins (rule 7)
// need history and live in list-state.ts.

import { verifyEvent } from 'nostr-tools/pure'
import type { NostrEvent } from 'nostr-tools/core'
import { decryptJson } from '../crypto/aead.ts'
import { isHex } from '../model/guards.ts'
import { LIMITS } from '../model/limits.ts'
import { isExpired } from './build.ts'
import type { ClaimPayload, ItemPayload, ListMetaPayload } from '../model/types.ts'
import { parseClaimPayload, parseItemPayload, parseListMetaPayload, tryParse } from '../model/validate.ts'
import { HIPPO_KIND, parseSlot } from './slots.ts'

export interface ReceiveContext {
  topic: string
  ownerPubkey: string
  contentKey: Uint8Array
  /** Absent on the owner side: claim events are then always rejected. */
  claimsKey?: Uint8Array
  /**
   * Milliseconds since epoch (the device's corrected clock, `CoreDeps.now`); used to drop expired
   * events and future-dated claims. Required, so judging time never falls back to an uncorrected clock.
   */
  now: () => number
}

export type AcceptedEvent =
  | { type: 'meta'; event: NostrEvent; d: string; payload: ListMetaPayload }
  /** `payload: null` is an owner tombstone (empty content). */
  | { type: 'item'; event: NostrEvent; d: string; itemId: string; payload: ItemPayload | null }
  | { type: 'claim'; event: NostrEvent; d: string; claimId: string; payload: ClaimPayload }

export type RejectReason =
  | 'malformed'
  | 'bad-signature'
  | 'wrong-kind'
  | 'wrong-topic'
  | 'bad-slot'
  | 'not-owner'
  | 'no-claims-key'
  | 'decrypt-failed'
  | 'invalid-payload'
  | 'id-mismatch'
  | 'expired'
  | 'future'

export type ReceiveResult = { ok: true; accepted: AcceptedEvent } | { ok: false; reason: RejectReason }

const MAX_TAGS = 16
const MAX_TAG_VALUE = 512

/**
 * Copies only the NIP-01 fields after checking their shapes. The fresh object
 * also defeats nostr-tools' per-object verification cache, so a tampered
 * object that was verified earlier is checked again.
 */
export function sanitizeEvent(raw: unknown): NostrEvent | null {
  if (typeof raw !== 'object' || raw === null) return null
  const e = raw as Record<string, unknown>
  if (!isHex(e.id, 32) || !isHex(e.pubkey, 32) || !isHex(e.sig, 64)) return null
  if (typeof e.kind !== 'number' || !Number.isSafeInteger(e.kind)) return null
  if (typeof e.created_at !== 'number' || !Number.isSafeInteger(e.created_at) || e.created_at < 0) return null
  if (typeof e.content !== 'string') return null
  if (!Array.isArray(e.tags) || e.tags.length > MAX_TAGS) return null
  const tags: string[][] = []
  for (const t of e.tags as unknown[]) {
    if (!Array.isArray(t) || t.length === 0 || t.length > 8) return null
    if (!t.every((v): v is string => typeof v === 'string' && v.length <= MAX_TAG_VALUE)) return null
    tags.push([...t])
  }
  return {
    id: e.id,
    pubkey: e.pubkey,
    sig: e.sig,
    kind: e.kind,
    created_at: e.created_at,
    content: e.content,
    tags,
  }
}

/** The single value of a tag; `null` when it is missing or repeated (ambiguous). */
function singleTag(event: NostrEvent, name: string): string | null {
  const found = event.tags.filter((t) => t[0] === name)
  if (found.length !== 1) return null
  return found[0]?.[1] ?? null
}

export function receiveEvent(raw: unknown, ctx: ReceiveContext): ReceiveResult {
  const event = sanitizeEvent(raw)
  if (!event) return { ok: false, reason: 'malformed' }
  if (event.kind !== HIPPO_KIND) return { ok: false, reason: 'wrong-kind' }
  if (singleTag(event, 't') !== ctx.topic) return { ok: false, reason: 'wrong-topic' }
  const d = singleTag(event, 'd')
  const slot = d === null ? null : parseSlot(d, ctx.topic)
  if (d === null || !slot) return { ok: false, reason: 'bad-slot' }
  if (slot.type !== 'claim' && event.pubkey !== ctx.ownerPubkey) return { ok: false, reason: 'not-owner' }
  if (slot.type === 'claim' && !ctx.claimsKey) return { ok: false, reason: 'no-claims-key' }
  const now = ctx.now()
  if (event.tags.filter((t) => t[0] === 'expiration').length > 1) return { ok: false, reason: 'malformed' }
  if (isExpired(event, now)) return { ok: false, reason: 'expired' }
  const latest = now + LIMITS.futureSkewMs
  if (slot.type === 'claim' && event.created_at * 1000 > latest) return { ok: false, reason: 'future' }
  // Signature last among the cheap checks: it is the expensive one.
  if (!verifyEvent(event)) return { ok: false, reason: 'bad-signature' }

  if (slot.type === 'item' && event.content === '') {
    return { ok: true, accepted: { type: 'item', event, d, itemId: slot.itemId, payload: null } }
  }
  const key = slot.type === 'claim' ? ctx.claimsKey : ctx.contentKey
  if (!key) return { ok: false, reason: 'no-claims-key' }
  const json = decryptJson(key, event.content, d)
  if (json === null) return { ok: false, reason: 'decrypt-failed' }

  switch (slot.type) {
    case 'meta': {
      const payload = tryParse(parseListMetaPayload, json)
      if (!payload) return { ok: false, reason: 'invalid-payload' }
      return { ok: true, accepted: { type: 'meta', event, d, payload } }
    }
    case 'item': {
      const payload = tryParse(parseItemPayload, json)
      if (!payload) return { ok: false, reason: 'invalid-payload' }
      if (payload.id !== slot.itemId) return { ok: false, reason: 'id-mismatch' }
      return { ok: true, accepted: { type: 'item', event, d, itemId: slot.itemId, payload } }
    }
    case 'claim': {
      const payload = tryParse(parseClaimPayload, json)
      if (!payload) return { ok: false, reason: 'invalid-payload' }
      if (payload.id !== slot.claimId) return { ok: false, reason: 'id-mismatch' }
      if (payload.createdAt > latest || payload.updatedAt > latest) return { ok: false, reason: 'future' }
      return { ok: true, accepted: { type: 'claim', event, d, claimId: slot.claimId, payload } }
    }
  }
}

/** Rule 7 ordering: higher created_at wins, ties broken by lower event id. */
export function isNewer(candidate: NostrEvent, current: NostrEvent): boolean {
  if (candidate.created_at !== current.created_at) return candidate.created_at > current.created_at
  return candidate.id < current.id
}

/** Ascending order used to decide which author saw a slot first (rule 5 tie-break). */
export function compareFirstSeen(a: NostrEvent, b: NostrEvent): number {
  if (a.created_at !== b.created_at) return a.created_at - b.created_at
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
