// Moving Hippo to another device without a file, PROTOCOL.md section 11. Pure parts: the link,
// key derivation, events, and checking what came back. The service (services/transfer.ts) does
// the network and the database.
//
// The source device encrypts the same payload a backup file holds under a fresh 32-byte transfer
// secret, splits it into chunks and publishes them for 15 minutes as kind 30078 events signed by
// a fresh one-time key. The link carries the secret and that key's public half. Anyone holding the
// link within those 15 minutes can read everything in it: it is treated like a backup file.

import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure'
import type { NostrEvent } from 'nostr-tools/core'
import { DEFAULT_RELAYS, sameRelaySet } from '../config.ts'
import { decryptJson, encryptJson } from '../crypto/aead.ts'
import {
  base64Decode,
  base64Encode,
  base64UrlDecode,
  base64UrlEncode,
  bytesEqual,
  bytesToHex,
  concatBytes,
  hexToBytes,
  randomBytes,
  utf8Decode,
  utf8Encode,
} from '../crypto/bytes.ts'
import { isValidPubkey, publicKeyOf } from '../crypto/keys.ts'
import { isHex, isObject } from '../model/guards.ts'
import { LIMITS } from '../model/limits.ts'
import { isRelayUrl } from '../model/validate.ts'
import { expirationOf, nextCreatedAt } from './build.ts'
import { isNewer, sanitizeEvent } from './receive.ts'
import { HIPPO_KIND } from './slots.ts'

/** How long a transfer link works. */
export const TRANSFER_TTL_MS = 15 * 60 * 1000
/** Event content that common relays accept (base64 characters). */
export const TRANSFER_MAX_EVENT_CONTENT = 32 * 1024
const NONCE = 24
const TAG = 16
/** Bytes of payload per chunk, so that base64(nonce || ciphertext) stays within TRANSFER_MAX_EVENT_CONTENT. */
export const TRANSFER_CHUNK_BYTES = Math.floor(TRANSFER_MAX_EVENT_CONTENT / 4) * 3 - NONCE - TAG
/** Largest payload sent (after compression). Larger backups are moved with a file. */
export const TRANSFER_MAX_SENT_BYTES = 2 * 1024 * 1024
/** Largest backup (before compression), on both sides: a receiver never inflates more than this. */
export const TRANSFER_MAX_PLAIN_BYTES = 8 * 1024 * 1024
export const TRANSFER_MAX_CHUNKS = Math.ceil(TRANSFER_MAX_SENT_BYTES / TRANSFER_CHUNK_BYTES)
/** Link version byte. */
export const TRANSFER_LINK_VERSION = 0x01
const LINK_FIXED = 1 + 32 + 32 + 4
const MAX_LINK_CHARS = 4096
/** HKDF salt: distinct from list derivations ("hippo/v1"), so no transfer value can equal a list value. */
const SALT = utf8Encode('hippo-transfer/v1')
const SLOT_PREFIX = 'hippo-transfer:'
export const TRANSFER_FRAGMENT = '#/t/'

export type TransferFailure =
  /** Not a transfer link at all, or damaged. */
  | 'invalid-link'
  /** A link version this copy of Hippo does not know. */
  | 'unsupported-version'
  | 'expired'
  /** The sync servers answered but have nothing for this link (expired early, or never sent). */
  | 'not-found'
  /** No sync server answered. */
  | 'offline'
  | 'cancelled'
  /** Already received on another device. */
  | 'used'
  /** Part of it is not on any sync server. */
  | 'missing'
  /** Something did not match: a chunk, the length or the hash. */
  | 'tampered'
  | 'too-large'
  /** It decrypted, but is not a valid backup (the same checks as importing a file). */
  | 'invalid-backup'
  /** This browser cannot unpack it. */
  | 'unsupported'

export class TransferError extends Error {
  readonly reason: TransferFailure
  constructor(reason: TransferFailure, message: string = reason) {
    super(message)
    this.name = 'TransferError'
    this.reason = reason
  }
}

export function isTransferError(e: unknown, reason?: TransferFailure): e is TransferError {
  return e instanceof TransferError && (reason === undefined || e.reason === reason)
}

// ------------------------------------------------------------------ link

export interface TransferLink {
  /** 32 bytes hex. Never logged, never shown except inside the link. */
  secret: string
  /** The one-time signing key's public key (x-only, hex). */
  pubkey: string
  /** Unix seconds after which the transfer is gone. */
  expiresAt: number
  /** `undefined`: the default relays. */
  relays?: string[]
}

export function encodeTransferPayload(l: TransferLink): string {
  if (!isHex(l.secret, 32) || !isHex(l.pubkey, 32)) throw new TransferError('invalid-link')
  if (!Number.isSafeInteger(l.expiresAt) || l.expiresAt < 0 || l.expiresAt > 0xffffffff) throw new TransferError('invalid-link')
  const exp = new Uint8Array(4)
  new DataView(exp.buffer).setUint32(0, l.expiresAt)
  const parts: Uint8Array[] = [new Uint8Array([TRANSFER_LINK_VERSION]), hexToBytes(l.secret), hexToBytes(l.pubkey), exp]
  if (l.relays !== undefined) {
    validateRelays(l.relays)
    parts.push(utf8Encode(l.relays.join(',')))
  }
  return base64UrlEncode(concatBytes(...parts))
}

function validateRelays(relays: readonly string[]): void {
  if (relays.length === 0 || relays.length > LIMITS.relays) throw new TransferError('invalid-link')
  for (const r of relays) if (r.length > LIMITS.relayUrl || !isRelayUrl(r)) throw new TransferError('invalid-link')
}

/** Strict decoder. Unknown versions are `unsupported-version`; anything else wrong is `invalid-link`. */
export function decodeTransferPayload(payload: string): TransferLink {
  if (payload.length === 0 || payload.length > MAX_LINK_CHARS) throw new TransferError('invalid-link')
  let bytes: Uint8Array
  try {
    bytes = base64UrlDecode(payload)
  } catch {
    throw new TransferError('invalid-link')
  }
  if (bytes.length === 0) throw new TransferError('invalid-link')
  if (bytes[0] !== TRANSFER_LINK_VERSION) throw new TransferError('unsupported-version')
  if (bytes.length < LINK_FIXED) throw new TransferError('invalid-link')
  const secret = bytesToHex(bytes.subarray(1, 33))
  const pubkey = bytesToHex(bytes.subarray(33, 65))
  const expiresAt = new DataView(bytes.buffer, bytes.byteOffset + 65, 4).getUint32(0)
  if (!isValidPubkey(pubkey)) throw new TransferError('invalid-link')
  if (bytes.length === LINK_FIXED) return { secret, pubkey, expiresAt }
  let text: string
  try {
    text = utf8Decode(bytes.subarray(LINK_FIXED))
  } catch {
    throw new TransferError('invalid-link')
  }
  const relays = text.split(',')
  validateRelays(relays)
  return { secret, pubkey, expiresAt, relays }
}

/**
 * The payload in what someone pasted or opened: a full link (`https://<site>/#/t/<payload>`, from
 * any Hippo site), the bare `#/t/<payload>`, or the payload itself, with words around it allowed.
 */
export function extractTransferPayload(input: string): string {
  if (typeof input !== 'string' || input.length > 8192) throw new TransferError('invalid-link')
  const s = input.trim()
  const idx = s.indexOf(TRANSFER_FRAGMENT)
  if (idx >= 0) {
    const m = /^[A-Za-z0-9_-]+/.exec(s.slice(idx + TRANSFER_FRAGMENT.length))
    if (!m) throw new TransferError('invalid-link')
    return m[0]
  }
  if (/^[A-Za-z0-9_-]+$/.test(s)) return s
  throw new TransferError('invalid-link')
}

/** True when the text holds something that looks like a transfer link (not checked further). */
export function looksLikeTransferLink(input: string): boolean {
  return typeof input === 'string' && input.length <= 8192 && /#\/t\/[A-Za-z0-9_-]{20,}/.test(input)
}

export function parseTransferLink(input: string): TransferLink {
  return decodeTransferPayload(extractTransferPayload(input))
}

/** `https://<site>/#/t/<payload>`; any query or fragment on the base is dropped. */
export function buildTransferUrl(siteBase: string, link: TransferLink): string {
  const u = new URL(siteBase)
  u.hash = ''
  u.search = ''
  let base = u.toString()
  if (!base.endsWith('/')) base += '/'
  return base + TRANSFER_FRAGMENT + encodeTransferPayload(link)
}

/** The relays a link names, or the defaults; and the link form of a relay set (undefined for the defaults). */
export function relaysOfLink(l: TransferLink): readonly string[] {
  return l.relays ?? DEFAULT_RELAYS
}
export function linkRelaysFor(relays: readonly string[]): string[] | undefined {
  return sameRelaySet(relays, DEFAULT_RELAYS) ? undefined : [...relays]
}

// ------------------------------------------------------------------ keys and slots

export interface TransferKeys {
  contentKey: Uint8Array
  topic: string
}

export function deriveTransferKeys(secretHex: string): TransferKeys {
  if (!isHex(secretHex, 32)) throw new TransferError('invalid-link')
  const ikm = hexToBytes(secretHex)
  return {
    contentKey: hkdf(sha256, ikm, SALT, utf8Encode('content'), 32),
    topic: bytesToHex(hkdf(sha256, ikm, SALT, utf8Encode('topic'), 32)),
  }
}

export function manifestSlot(topic: string): string {
  return `${SLOT_PREFIX}${topic}:manifest`
}
export function chunkSlot(topic: string, index: number): string {
  return `${SLOT_PREFIX}${topic}:chunk:${index}`
}

export type TransferSlot = { type: 'manifest' } | { type: 'chunk'; index: number }

export function parseTransferSlot(d: string, topic: string): TransferSlot | null {
  const prefix = `${SLOT_PREFIX}${topic}:`
  if (!d.startsWith(prefix)) return null
  const rest = d.slice(prefix.length)
  if (rest === 'manifest') return { type: 'manifest' }
  const m = /^chunk:(0|[1-9][0-9]{0,3})$/.exec(rest)
  if (!m?.[1]) return null
  const index = Number(m[1])
  return index < TRANSFER_MAX_CHUNKS ? { type: 'chunk', index } : null
}

// ------------------------------------------------------------------ payload encryption

/** base64(nonce(24) || XChaCha20-Poly1305(bytes)), AAD = the slot (binds topic and chunk index). */
export function encryptChunk(key: Uint8Array, bytes: Uint8Array, aad: string): string {
  const nonce = randomBytes(NONCE)
  return base64Encode(concatBytes(nonce, xchacha20poly1305(key, nonce, utf8Encode(aad)).encrypt(bytes)))
}

/** The chunk's bytes, or null on any failure. Never throws. */
export function decryptChunk(key: Uint8Array, content: string, aad: string): Uint8Array | null {
  if (content.length === 0 || content.length > TRANSFER_MAX_EVENT_CONTENT) return null
  try {
    const raw = base64Decode(content)
    if (raw.length < NONCE + TAG) return null
    return xchacha20poly1305(key, raw.subarray(0, NONCE), utf8Encode(aad)).decrypt(raw.subarray(NONCE))
  } catch {
    return null
  }
}

export function splitChunks(bytes: Uint8Array, size: number = TRANSFER_CHUNK_BYTES): Uint8Array[] {
  const out: Uint8Array[] = []
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, Math.min(bytes.length, i + size)))
  return out.length > 0 ? out : [new Uint8Array(0)]
}

export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes))
}

// ------------------------------------------------------------------ manifest

export type TransferEncoding = 'gzip' | 'none'

export interface TransferManifest {
  v: 1
  kind: 'manifest'
  chunks: number
  /** Bytes sent: the sum of the chunks (compressed when `encoding` is gzip). */
  length: number
  /** SHA-256 of the backup JSON before compression, hex. */
  sha256: string
  encoding: TransferEncoding
  /** The one-time signing key, so the receiving device can clear the chunks from the sync servers once it has them. */
  key: string
}

/** What replaces the manifest when the transfer ends: received on another device, or cancelled. */
export interface TransferMarker {
  v: 1
  kind: 'done' | 'cancelled'
}

export type ManifestSlotPayload = TransferManifest | TransferMarker

export function parseManifestPayload(value: unknown, pubkey: string): ManifestSlotPayload | null {
  if (!isObject(value) || value.v !== 1) return null
  if (value.kind === 'done' || value.kind === 'cancelled') return { v: 1, kind: value.kind }
  if (value.kind !== 'manifest') return null
  const { chunks, length, sha256: hash, encoding, key } = value
  if (typeof chunks !== 'number' || !Number.isSafeInteger(chunks) || chunks < 1 || chunks > TRANSFER_MAX_CHUNKS) return null
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 1 || length > TRANSFER_MAX_SENT_BYTES) return null
  if (length > chunks * TRANSFER_CHUNK_BYTES || length <= (chunks - 1) * TRANSFER_CHUNK_BYTES) return null
  if (!isHex(hash, 32) || (encoding !== 'gzip' && encoding !== 'none') || !isHex(key, 32)) return null
  if (publicKeyOf(key) !== pubkey) return null
  return { v: 1, kind: 'manifest', chunks, length, sha256: hash, encoding, key }
}

// ------------------------------------------------------------------ events

export interface TransferSignOptions {
  topic: string
  secretKey: string
  createdAt: number
  expiresAt: number
}

function signTransfer(d: string, content: string, o: TransferSignOptions): NostrEvent {
  return finalizeEvent(
    {
      kind: HIPPO_KIND,
      created_at: o.createdAt,
      tags: [
        ['d', d],
        ['t', o.topic],
        ['expiration', String(o.expiresAt)],
      ],
      content,
    },
    hexToBytes(o.secretKey),
  )
}

export function buildChunkEvent(keys: TransferKeys, index: number, bytes: Uint8Array, o: Omit<TransferSignOptions, 'topic'>): NostrEvent {
  const d = chunkSlot(keys.topic, index)
  return signTransfer(d, encryptChunk(keys.contentKey, bytes, d), { ...o, topic: keys.topic })
}

export function buildManifestEvent(keys: TransferKeys, payload: ManifestSlotPayload, o: Omit<TransferSignOptions, 'topic'>): NostrEvent {
  const d = manifestSlot(keys.topic)
  return signTransfer(d, encryptJson(keys.contentKey, payload, d), { ...o, topic: keys.topic })
}

/** An empty chunk, published over a chunk once the transfer ended, for relays that ignore deletion requests. */
export function buildChunkTombstone(keys: TransferKeys, index: number, o: Omit<TransferSignOptions, 'topic'>): NostrEvent {
  return signTransfer(chunkSlot(keys.topic, index), '', { ...o, topic: keys.topic })
}

/** NIP-09 deletion requests for the chunk slots (`a` tags), in batches small enough for any relay. */
export function buildDeletionEvents(pubkey: string, keys: TransferKeys, chunks: number, o: Omit<TransferSignOptions, 'topic'>): NostrEvent[] {
  const out: NostrEvent[] = []
  for (let start = 0; start < chunks; start += 12) {
    const tags: string[][] = [['k', String(HIPPO_KIND)]]
    for (let i = start; i < Math.min(chunks, start + 12); i++) tags.push(['a', `${HIPPO_KIND}:${pubkey}:${chunkSlot(keys.topic, i)}`])
    tags.push(['expiration', String(o.expiresAt)])
    out.push(finalizeEvent({ kind: 5, created_at: o.createdAt, tags, content: '' }, hexToBytes(o.secretKey)))
  }
  return out
}

/** `created_at` for an event that must replace one created at `previous`. */
export function replacementCreatedAt(nowMs: number, previous: number): number {
  return nextCreatedAt(nowMs, previous)
}

// ------------------------------------------------------------------ receiving

export interface TransferEventCheck {
  topic: string
  pubkey: string
  /** Corrected clock, ms. */
  now: number
}

/** The event when it is a well-formed, correctly signed, unexpired transfer event by the link's key, else null. */
export function acceptTransferEvent(raw: unknown, c: TransferEventCheck): { event: NostrEvent; d: string; slot: TransferSlot } | null {
  const event = sanitizeEvent(raw)
  if (!event || event.kind !== HIPPO_KIND || event.pubkey !== c.pubkey) return null
  const t = event.tags.filter((x) => x[0] === 't')
  const d = event.tags.filter((x) => x[0] === 'd')
  if (t.length !== 1 || t[0]?.[1] !== c.topic || d.length !== 1) return null
  const slotName = d[0]?.[1] ?? ''
  const slot = parseTransferSlot(slotName, c.topic)
  if (!slot) return null
  const exp = expirationOf(event)
  if (exp === undefined || exp * 1000 <= c.now) return null
  if (!verifyEvent(event)) return null
  return { event, d: slotName, slot }
}

/** Newest first (the same order relays use to replace addressable events). */
export function newestFirst(events: readonly NostrEvent[]): NostrEvent[] {
  return [...events].sort((a, b) => (isNewer(a, b) ? -1 : isNewer(b, a) ? 1 : 0))
}

export interface CollectedTransfer {
  manifest: TransferManifest
  manifestEvent: NostrEvent
  /** The concatenated chunks, exactly `manifest.length` bytes. */
  bytes: Uint8Array
  /** Every chunk event used, by index. */
  chunkEvents: NostrEvent[]
}

/**
 * Checks everything the sync servers returned for a link and puts the payload together. Events by
 * any other key, with a bad signature, an unknown slot or past their expiry are ignored; anything
 * that cannot be decrypted is never used. Throws `TransferError` with the specific reason.
 */
export function collectTransfer(raw: readonly unknown[], link: TransferLink, keys: TransferKeys, now: number): CollectedTransfer {
  const check: TransferEventCheck = { topic: keys.topic, pubkey: link.pubkey, now }
  const bySlot = new Map<string, NostrEvent[]>()
  let sawManifestSlot = false
  for (const r of raw) {
    const a = acceptTransferEvent(r, check)
    if (!a) continue
    if (a.slot.type === 'manifest') sawManifestSlot = true
    const list = bySlot.get(a.d) ?? []
    if (!list.some((e) => e.id === a.event.id)) list.push(a.event)
    bySlot.set(a.d, list)
  }
  const mSlot = manifestSlot(keys.topic)
  let manifest: TransferManifest | undefined
  let manifestEvent: NostrEvent | undefined
  for (const e of newestFirst(bySlot.get(mSlot) ?? [])) {
    const payload = parseManifestPayload(decryptJson(keys.contentKey, e.content, mSlot), link.pubkey)
    if (!payload) continue
    if (payload.kind === 'done') throw new TransferError('used')
    if (payload.kind === 'cancelled') throw new TransferError('cancelled')
    if (payload.kind !== 'manifest') continue
    manifest = payload
    manifestEvent = e
    break
  }
  if (!manifest || !manifestEvent) {
    if (sawManifestSlot) throw new TransferError('tampered')
    throw new TransferError('not-found')
  }
  const parts: Uint8Array[] = []
  const chunkEvents: NostrEvent[] = []
  for (let i = 0; i < manifest.chunks; i++) {
    const slot = chunkSlot(keys.topic, i)
    const expected = i < manifest.chunks - 1 ? TRANSFER_CHUNK_BYTES : manifest.length - (manifest.chunks - 1) * TRANSFER_CHUNK_BYTES
    const candidates = newestFirst(bySlot.get(slot) ?? [])
    if (candidates.length === 0) throw new TransferError('missing')
    // An emptied chunk: the transfer ended (cancelled, or received elsewhere) after this manifest was read.
    if (candidates[0]?.content === '') throw new TransferError('cancelled')
    let found: Uint8Array | null = null
    for (const e of candidates) {
      const bytes = decryptChunk(keys.contentKey, e.content, slot)
      if (bytes && bytes.length === expected) {
        found = bytes
        chunkEvents.push(e)
        break
      }
    }
    if (!found) throw new TransferError('tampered')
    parts.push(found)
  }
  const bytes = concatBytes(...parts)
  if (bytes.length !== manifest.length) throw new TransferError('tampered')
  return { manifest, manifestEvent, bytes, chunkEvents }
}

/** Checks the hash of the unpacked backup JSON. */
export function verifyPlaintext(plain: Uint8Array, manifest: TransferManifest): void {
  if (!bytesEqual(sha256(plain), hexToBytes(manifest.sha256))) throw new TransferError('tampered')
}
