// Relay health canaries, used by scripts/relay-health.mjs. A canary is a small
// event shaped like real Hippo traffic (kind 30078, opaque content, `d`, `t`
// and NIP-40 `expiration` tags). Its key is derived from a fixed public
// string plus the ISO week, so a later run can recompute the key of an
// earlier week and ask relays whether that week's canary is still stored.
// The key protects nothing: it only has to be reproducible.

import { sha256 } from '@noble/hashes/sha2.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../transport/types.ts'
import { randomBytes, utf8Encode } from '../crypto/bytes.ts'

/** Public, fixed. Changing it orphans every earlier canary. */
export const CANARY_KEY_LABEL = 'hippo-relay-canary-v1'
/** Real topics are 64 lowercase hex characters; every canary topic starts with this non-hex prefix. */
export const CANARY_TOPIC_PREFIX = 'hippo-canary-'
export const CANARY_KIND = 30078
/** NIP-40 expiration of a canary. Longer than the 12-week lookback (84 days) so the oldest check is still valid. */
export const CANARY_EXPIRY_DAYS = 100
/** Random content size in bytes before base64: about the size of a padded Hippo item. */
export const CANARY_CONTENT_BYTES = 768
/** Earlier canaries the health check looks for, in weeks. */
export const CANARY_LOOKBACK_WEEKS: readonly number[] = [1, 4, 12]

/** ISO 8601 week of a date in UTC, e.g. "2026-W47". */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum) // the Thursday of this week decides the year
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** The ISO week `weeksAgo` weeks before `now`. */
export function isoWeekAgo(now: Date, weeksAgo: number): string {
  return isoWeek(new Date(now.getTime() - weeksAgo * 7 * 86_400_000))
}

function assertWeek(week: string): void {
  if (!/^\d{4}-W\d{2}$/.test(week)) throw new Error('week must look like 2026-W47')
}

/** Deterministic secp256k1 secret key for a week. Retries with a counter in the (practically impossible) case the hash is not a valid key. */
export function canarySecretKey(week: string): Uint8Array {
  assertWeek(week)
  for (let n = 0; n < 16; n++) {
    const candidate = sha256(utf8Encode(`${CANARY_KEY_LABEL}:${week}:${n}`))
    if (secp256k1.utils.isValidSecretKey(candidate)) return candidate
  }
  throw new Error('no valid canary key')
}

export function canaryPubkey(week: string): string {
  return getPublicKey(canarySecretKey(week))
}

/** The `t` tag: "hippo-canary-2026-W47". Never 64 hex characters, so no real list can share it. */
export function canaryTopic(week: string): string {
  assertWeek(week)
  return `${CANARY_TOPIC_PREFIX}${week}`
}

/** The `d` tag, shaped like a real slot (`hippo:<topic>:item:<id>`) with a canary topic. */
export function canarySlot(week: string): string {
  return `hippo:${canaryTopic(week)}:item:probe`
}

/** A signed canary event for `week`, created at `nowSec`. `content` defaults to fresh random bytes (base64). */
export function buildCanaryEvent(week: string, nowSec: number, content?: string): NostrEvent {
  const body = content ?? btoa(String.fromCharCode(...randomBytes(CANARY_CONTENT_BYTES)))
  const template = {
    kind: CANARY_KIND,
    created_at: nowSec,
    content: body,
    tags: [
      ['d', canarySlot(week)],
      ['t', canaryTopic(week)],
      ['expiration', String(nowSec + CANARY_EXPIRY_DAYS * 86_400)],
    ],
  }
  return finalizeEvent(template, canarySecretKey(week)) as NostrEvent
}

export interface CanaryTarget {
  weeksAgo: number
  week: string
  pubkey: string
  topic: string
  slot: string
}

/** Weeks to look for, with the author, topic and slot each one must have. */
export function canaryTargets(now: Date, weeksAgo: readonly number[] = CANARY_LOOKBACK_WEEKS): CanaryTarget[] {
  return weeksAgo.map((n) => {
    const week = isoWeekAgo(now, n)
    return { weeksAgo: n, week, pubkey: canaryPubkey(week), topic: canaryTopic(week), slot: canarySlot(week) }
  })
}

