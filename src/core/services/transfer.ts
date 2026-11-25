// Moving Hippo to another device without a file (PROTOCOL.md section 11): the network and database
// half. The pure half (link, keys, events, checks) is protocol/transfer.ts.

import type { NostrEvent } from 'nostr-tools/core'
import { generateSigningKey, publicKeyOf } from '../crypto/keys.ts'
import { randomBytes, bytesToHex, utf8Decode, utf8Encode } from '../crypto/bytes.ts'
import { decryptJson } from '../crypto/aead.ts'
import { getSettings, setOnboarding } from '../db/settings.ts'
import { DEFAULT_RELAYS } from '../config.ts'
import { HippoError } from '../errors.ts'
import {
  acceptTransferEvent,
  buildChunkEvent,
  buildChunkTombstone,
  buildDeletionEvents,
  buildManifestEvent,
  buildTransferUrl,
  collectTransfer,
  deriveTransferKeys,
  linkRelaysFor,
  manifestSlot,
  parseManifestPayload,
  parseTransferLink,
  relaysOfLink,
  replacementCreatedAt,
  sha256Hex,
  splitChunks,
  TransferError,
  TRANSFER_MAX_PLAIN_BYTES,
  TRANSFER_MAX_SENT_BYTES,
  TRANSFER_TTL_MS,
  verifyPlaintext,
  type TransferEncoding,
  type TransferKeys,
  type TransferLink,
  type TransferManifest,
} from '../protocol/transfer.ts'
import { HIPPO_KIND } from '../protocol/slots.ts'
import type { EoseInfo, Filter, Transport } from '../transport/types.ts'
import { exportData, importData, parseExportFile, type ExportFile, type ImportResult } from './backup.ts'
import type { CoreDeps } from './deps.ts'

export interface TransferSummary {
  items: number
  lists: number
  categories: number
}

/** What the source device holds while a transfer is open. Keep it in memory only. */
export interface OutgoingTransfer {
  /** The link to give to the other device: `https://<site>/#/t/<payload>`. Contains the secret. */
  url: string
  link: TransferLink
  /** Milliseconds since epoch (corrected clock) when it stops working. */
  expiresAtMs: number
  summary: TransferSummary
  chunks: number
  /** Bytes sent (after compression). */
  bytes: number
  /** @internal */ secretKey: string
  /** @internal */ createdAt: number
}

export interface IncomingTransfer {
  link: TransferLink
  file: ExportFile
  summary: TransferSummary
  /** A device link: the account secret. Memory only. */
  account?: string
  /** @internal */ manifest: TransferManifest
  /** @internal */ manifestCreatedAt: number
  /** @internal */ chunkEvents: NostrEvent[]
}

function summaryOf(file: ExportFile): TransferSummary {
  return { items: file.items.length, lists: file.sharedLists.length + file.guestLists.length, categories: file.categories.length }
}

function transferRelays(deps: CoreDeps, relays: readonly string[]): Transport {
  return deps.transports(relays)
}

// ------------------------------------------------------------------ compression

async function pipeBytes(bytes: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>, max: number): Promise<Uint8Array> {
  const writer = stream.writable.getWriter()
  void writer.write(bytes).then(() => writer.close()).catch(() => undefined)
  const reader = stream.readable.getReader()
  const parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > max) {
      await reader.cancel().catch(() => undefined)
      throw new TransferError('too-large')
    }
    parts.push(value)
  }
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

function canCompress(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function'
}

async function pack(plain: Uint8Array): Promise<{ bytes: Uint8Array; encoding: TransferEncoding }> {
  if (!canCompress()) return { bytes: plain, encoding: 'none' }
  try {
    const stream = new CompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>
    return { bytes: await pipeBytes(plain, stream, TRANSFER_MAX_PLAIN_BYTES), encoding: 'gzip' }
  } catch {
    return { bytes: plain, encoding: 'none' }
  }
}

async function unpack(bytes: Uint8Array, encoding: TransferEncoding): Promise<Uint8Array> {
  if (encoding === 'none') {
    if (bytes.length > TRANSFER_MAX_PLAIN_BYTES) throw new TransferError('too-large')
    return bytes
  }
  if (typeof DecompressionStream !== 'function') throw new TransferError('unsupported')
  try {
    const stream = new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>
    return await pipeBytes(bytes, stream, TRANSFER_MAX_PLAIN_BYTES)
  } catch (e) {
    if (e instanceof TransferError) throw e
    throw new TransferError('tampered')
  }
}

// ------------------------------------------------------------------ fetching

/** Everything the relays hold for a filter, and whether any relay answered at all. */
function collect(t: Transport, filter: Filter, timeoutMs: number): Promise<{ events: NostrEvent[]; answered: boolean }> {
  return new Promise((resolve) => {
    const seen = new Map<string, NostrEvent>()
    let done = false
    let answered = false
    let stop: () => void = () => undefined
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      stop()
      resolve({ events: [...seen.values()], answered })
    }
    const timer = setTimeout(finish, timeoutMs)
    stop = t.subscribe(
      filter,
      (e) => {
        if (!seen.has(e.id) && seen.size < 1000) seen.set(e.id, e)
      },
      (info: EoseInfo) => {
        answered = info.relaysAnswered > 0
        // Let events queued with the EOSE arrive first.
        setTimeout(finish, 0)
      },
    )
    if (done) stop()
  })
}

function filterFor(link: TransferLink, keys: TransferKeys): Filter {
  return { kinds: [HIPPO_KIND], authors: [link.pubkey], '#t': [keys.topic] }
}

async function publishAll(t: Transport, events: readonly NostrEvent[]): Promise<boolean> {
  // A few at a time: relays rate-limit bursts.
  let ok = true
  for (let i = 0; i < events.length; i += 4) {
    const results = await Promise.all(events.slice(i, i + 4).map((e) => t.publish(e)))
    if (results.some((r) => !r.ok)) ok = false
  }
  return ok
}

// ------------------------------------------------------------------ source

export interface CreateTransferOptions {
  /** The Hippo website the link points at (`https://<site>/`). */
  siteBase: string
  /** Called with the share of chunks sent so far, 0 to 1. */
  onProgress?: (share: number) => void
  /** A device link: the account secret travels with the snapshot, so the other device signs in (PROTOCOL.md section 12.6). */
  account?: string
}

/**
 * Starts a transfer: packs this device's backup, encrypts and publishes it for 15 minutes, and
 * returns the link. Throws `TransferError` (`too-large`, `offline`).
 */
export async function createTransfer(deps: CoreDeps, options: CreateTransferOptions): Promise<OutgoingTransfer> {
  const file = await exportData(deps.db, deps.now(), { record: false })
  const plain = utf8Encode(JSON.stringify(file))
  if (plain.length > TRANSFER_MAX_PLAIN_BYTES) throw new TransferError('too-large')
  const { bytes, encoding } = await pack(plain)
  if (bytes.length > TRANSFER_MAX_SENT_BYTES) throw new TransferError('too-large')

  const secret = bytesToHex(randomBytes(32))
  const secretKey = generateSigningKey()
  const pubkey = publicKeyOf(secretKey)
  const keys = deriveTransferKeys(secret)
  const now = deps.now()
  const createdAt = Math.floor(now / 1000)
  const expiresAtMs = now + TRANSFER_TTL_MS
  const expiresAt = Math.floor(expiresAtMs / 1000)
  const relays = (await getSettings(deps.db)).relays ?? [...DEFAULT_RELAYS]
  const linkRelays = linkRelaysFor(relays)
  const link: TransferLink = { secret, pubkey, expiresAt, ...(linkRelays ? { relays: linkRelays } : {}) }
  const url = buildTransferUrl(options.siteBase, link)

  const parts = splitChunks(bytes)
  const sign = { secretKey, createdAt, expiresAt }
  const transport = transferRelays(deps, relaysOfLink(link))
  for (let i = 0; i < parts.length; i += 4) {
    const batch = parts.slice(i, i + 4).map((p, j) => buildChunkEvent(keys, i + j, p, sign))
    if (!(await publishAll(transport, batch))) throw new TransferError('offline')
    options.onProgress?.(Math.min(1, (i + batch.length) / parts.length))
  }
  // The manifest last: a device that finds it finds every chunk too.
  const manifest: TransferManifest = {
    v: 1,
    kind: 'manifest',
    chunks: parts.length,
    length: bytes.length,
    sha256: sha256Hex(plain),
    encoding,
    key: secretKey,
    ...(options.account !== undefined ? { account: options.account } : {}),
  }
  if (!(await publishAll(transport, [buildManifestEvent(keys, manifest, sign)]))) throw new TransferError('offline')
  return { url, link, expiresAtMs, summary: summaryOf(file), chunks: parts.length, bytes: bytes.length, secretKey, createdAt }
}

/** Ends a transfer early: the manifest says cancelled, the chunks are emptied, and the relays are asked to delete them. */
export async function cancelTransfer(deps: CoreDeps, t: OutgoingTransfer): Promise<boolean> {
  return endTransfer(deps, t.link, t.secretKey, t.chunks, t.createdAt, 'cancelled')
}

async function endTransfer(deps: CoreDeps, link: TransferLink, secretKey: string, chunks: number, after: number, kind: 'done' | 'cancelled'): Promise<boolean> {
  const keys = deriveTransferKeys(link.secret)
  const sign = { secretKey, createdAt: replacementCreatedAt(deps.now(), after), expiresAt: link.expiresAt }
  const events: NostrEvent[] = [buildManifestEvent(keys, { v: 1, kind }, sign)]
  for (let i = 0; i < chunks; i++) events.push(buildChunkTombstone(keys, i, sign))
  events.push(...buildDeletionEvents(link.pubkey, keys, chunks, sign))
  return publishAll(transferRelays(deps, relaysOfLink(link)), events)
}

export type OutgoingState = 'waiting' | 'moved' | 'cancelled'

/**
 * Watches an open transfer from the source device: `moved` once another device has received it
 * (it replaced the manifest with a "done" marker only the link's holder can write).
 */
export function watchTransfer(deps: CoreDeps, t: OutgoingTransfer, onState: (s: OutgoingState) => void): () => void {
  const keys = deriveTransferKeys(t.link.secret)
  const slot = manifestSlot(keys.topic)
  const transport = transferRelays(deps, relaysOfLink(t.link))
  let last: OutgoingState = 'waiting'
  return transport.subscribe(filterFor(t.link, keys), (raw) => {
    const a = acceptTransferEvent(raw, { topic: keys.topic, pubkey: t.link.pubkey, now: deps.now() })
    if (!a || a.slot.type !== 'manifest' || a.event.created_at < t.createdAt) return
    const payload = parseManifestPayload(decryptJson(keys.contentKey, a.event.content, slot), t.link.pubkey)
    const next: OutgoingState | undefined = payload?.kind === 'done' ? 'moved' : payload?.kind === 'cancelled' ? 'cancelled' : undefined
    if (next && next !== last) {
      last = next
      onState(next)
    }
  })
}

// ------------------------------------------------------------------ receiver

export interface FetchTransferOptions {
  timeoutMs?: number
}

/**
 * Fetches and checks a transfer for a link (pasted, or opened as `#/t/...`). Nothing is written.
 * The backup inside goes through exactly the validation of a backup file import. Throws
 * `TransferError` with the specific reason.
 */
export async function fetchTransfer(deps: CoreDeps, input: string, options: FetchTransferOptions = {}): Promise<IncomingTransfer> {
  const link = parseTransferLink(input)
  if (link.expiresAt * 1000 <= deps.now()) throw new TransferError('expired')
  const keys = deriveTransferKeys(link.secret)
  const { events, answered } = await collect(transferRelays(deps, relaysOfLink(link)), filterFor(link, keys), options.timeoutMs ?? 8000)
  if (!answered && events.length === 0) throw new TransferError('offline')
  // Judged again after the wait: it may have expired meanwhile.
  if (link.expiresAt * 1000 <= deps.now()) throw new TransferError('expired')
  const got = collectTransfer(events, link, keys, deps.now())
  const plain = await unpack(got.bytes, got.manifest.encoding)
  verifyPlaintext(plain, got.manifest)
  let file: ExportFile
  try {
    file = parseExportFile(JSON.parse(utf8Decode(plain)) as unknown)
  } catch {
    throw new TransferError('invalid-backup')
  }
  return {
    link,
    file,
    summary: summaryOf(file),
    ...(got.manifest.account !== undefined ? { account: got.manifest.account } : {}),
    manifest: got.manifest,
    manifestCreatedAt: got.manifestEvent.created_at,
    chunkEvents: got.chunkEvents,
  }
}

/** True when this device already holds wishes or lists, so a transfer would be merged with them. */
export async function deviceHasData(deps: CoreDeps): Promise<boolean> {
  const [items, lists, guests] = await Promise.all([deps.db.items.count(), deps.db.sharedLists.count(), deps.db.guestLists.count()])
  return items + lists + guests > 0
}

export interface ReceiveResult extends ImportResult {
  /** The sync servers were told the transfer is done (false: it simply expires in a few minutes). */
  cleared: boolean
  /** A device link: this device is now signed in to the account. */
  signedIn: boolean
}

/**
 * Writes a fetched transfer into this device with the backup merge rules (lists already here are
 * never replaced; never "replace everything"), marks setup done, then tells the sync servers the
 * transfer is done and empties the chunks, so the link cannot be used again.
 */
export async function receiveTransfer(deps: CoreDeps, t: IncomingTransfer): Promise<ReceiveResult> {
  if (t.link.expiresAt * 1000 <= deps.now()) throw new TransferError('expired')
  // Loaded only for a device link, so the account code stays out of the app's first download.
  const account = t.account !== undefined ? await import('../account/service.ts') : undefined
  if (t.account !== undefined) {
    const cur = await account?.accountState(deps.db)
    if (cur && cur.replacedAt === undefined && cur.secret !== t.account) throw new TransferError('other-account')
  }
  let result: ImportResult
  try {
    result = await importData(deps.db, t.file, { mode: 'merge', now: deps.now() })
  } catch (e) {
    if (e instanceof HippoError) throw new TransferError('invalid-backup', e.message)
    throw e
  }
  const onboarding = (await getSettings(deps.db)).onboarding
  if (!onboarding || onboarding.status === 'active') {
    await setOnboarding(deps.db, { status: 'completed', step: 0, answers: {}, updatedAt: deps.now() })
  }
  let signedIn = false
  if (t.account !== undefined && account) {
    try {
      await account.signInToAccount(deps, t.account)
      signedIn = true
    } catch (e) {
      if (account.isAccountError(e, 'other-account')) throw new TransferError('other-account')
      throw e
    }
  }
  let cleared = false
  try {
    cleared = await endTransfer(deps, t.link, t.manifest.key, t.manifest.chunks, t.manifestCreatedAt, 'done')
  } catch {
    cleared = false
  }
  return { ...result, cleared, signedIn }
}
