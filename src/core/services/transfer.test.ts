// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { finalizeEvent } from 'nostr-tools/pure'
import { base64UrlDecode, base64UrlEncode, hexToBytes, randomBytes, bytesToHex } from '../crypto/bytes.ts'
import { generateSigningKey, publicKeyOf } from '../crypto/keys.ts'
import { getSettings } from '../db/settings.ts'
import { MemoryNetwork } from '../transport/memory.ts'
import { flush, testClock, testDevice, waitFor, type TestDevice } from '../testing/fixtures.ts'
import {
  buildManifestEvent,
  chunkSlot,
  decodeTransferPayload,
  deriveTransferKeys,
  encodeTransferPayload,
  extractTransferPayload,
  looksLikeTransferLink,
  manifestSlot,
  parseManifestPayload,
  parseTransferSlot,
  TRANSFER_CHUNK_BYTES,
  TRANSFER_MAX_EVENT_CONTENT,
  TRANSFER_MAX_SENT_BYTES,
  TRANSFER_TTL_MS,
  type TransferFailure,
} from '../protocol/transfer.ts'
import { HIPPO_KIND } from '../protocol/slots.ts'
import { addGuestListFromLink } from './giver-lists.ts'
import { buildShareLink, createSharedList, getSharedList, publishList, syncList } from './owner-lists.ts'
import { cancelTransfer, createTransfer, deviceHasData, fetchTransfer, receiveTransfer, watchTransfer, type OutgoingState } from './transfer.ts'
import { createCategory, createItem } from './wishlist.ts'
import { setOwnerName } from '../db/settings.ts'

const SITE = 'https://hippo.example/'

function world() {
  const clock = testClock(Date.UTC(2026, 10, 24, 10))
  const network = new MemoryNetwork({ nowSeconds: () => Math.floor(clock.now() / 1000) })
  const dev = (name: string) => testDevice(network, clock, name)
  return { clock, network, dev }
}

async function populate(d: TestDevice, opts: { bigItems?: number } = {}) {
  const cat = await createCategory(d.db, 'Books')
  const a = await createItem(d.db, { title: 'A good book', categoryIds: [cat.id], price: { amount: 1999, currency: 'EUR' } })
  const b = await createItem(d.db, { title: 'Concert tickets' })
  for (let i = 0; i < (opts.bigItems ?? 0); i++) {
    // Random notes do not compress, so the payload really spans several chunks.
    await createItem(d.db, { title: `Wish ${i}`, notes: bytesToHex(randomBytes(900)) })
  }
  const list = await createSharedList(d, { name: 'Christmas', itemIds: [a.id, b.id] })
  await publishList(d, list.id)
  await setOwnerName(d.db, 'Ann')
  return { list, items: [a, b] }
}

async function expectFailure(p: Promise<unknown>, reason: TransferFailure) {
  await expect(p).rejects.toMatchObject({ name: 'TransferError', reason })
}

describe('transfer link', () => {
  it('round trips the version byte, secret, key, expiry and relays, and rejects anything else', () => {
    const secret = bytesToHex(randomBytes(32))
    const pubkey = publicKeyOf(generateSigningKey())
    const plain = { secret, pubkey, expiresAt: 1_800_000_000 }
    expect(decodeTransferPayload(encodeTransferPayload(plain))).toEqual(plain)
    const withRelays = { ...plain, relays: ['wss://relay.example.com'] }
    expect(decodeTransferPayload(encodeTransferPayload(withRelays))).toEqual(withRelays)
    const payload = encodeTransferPayload(plain)
    expect(extractTransferPayload(`Open this: ${SITE}#/t/${payload} thanks`)).toBe(payload)
    expect(looksLikeTransferLink(`${SITE}#/t/${payload}`)).toBe(true)
    expect(looksLikeTransferLink(`${SITE}#/l/${payload}`)).toBe(false)
    // A newer link version is refused as such, not as damage.
    const bytes = base64UrlDecode(payload)
    bytes[0] = 0x02
    expect(() => decodeTransferPayload(base64UrlEncode(bytes))).toThrow(expect.objectContaining({ reason: 'unsupported-version' }) as Error)
    expect(() => decodeTransferPayload(payload.slice(0, 40))).toThrow(expect.objectContaining({ reason: 'invalid-link' }) as Error)
    expect(() => decodeTransferPayload('!!!')).toThrow(expect.objectContaining({ reason: 'invalid-link' }) as Error)
    expect(() => encodeTransferPayload({ ...plain, relays: ['ws://127.0.0.1:7447'] })).toThrow()
  })

  it('derives keys and slots that cannot collide with list derivations', () => {
    const k = deriveTransferKeys(bytesToHex(randomBytes(32)))
    expect(k.topic).toMatch(/^[0-9a-f]{64}$/)
    expect(manifestSlot(k.topic)).toMatch(/^hippo-transfer:/)
    expect(parseTransferSlot(chunkSlot(k.topic, 3), k.topic)).toEqual({ type: 'chunk', index: 3 })
    expect(parseTransferSlot(`hippo:${k.topic}:meta`, k.topic)).toBeNull()
    expect(parseTransferSlot(`hippo-transfer:${k.topic}:chunk:007`, k.topic)).toBeNull()
    expect(parseTransferSlot(`hippo-transfer:${k.topic}:chunk:99999`, k.topic)).toBeNull()
    // Chunks stay under the event size relays accept.
    expect(Math.ceil((TRANSFER_CHUNK_BYTES + 40) / 3) * 4).toBeLessThanOrEqual(TRANSFER_MAX_EVENT_CONTENT)
  })

  it('refuses manifests that do not add up', () => {
    const key = generateSigningKey()
    const pub = publicKeyOf(key)
    const ok = { v: 1, kind: 'manifest', chunks: 2, length: TRANSFER_CHUNK_BYTES + 5, sha256: '00'.repeat(32), encoding: 'gzip', key }
    expect(parseManifestPayload(ok, pub)).toMatchObject({ chunks: 2 })
    expect(parseManifestPayload({ ...ok, length: TRANSFER_CHUNK_BYTES }, pub)).toBeNull()
    expect(parseManifestPayload({ ...ok, chunks: 1000 }, pub)).toBeNull()
    expect(parseManifestPayload({ ...ok, length: TRANSFER_MAX_SENT_BYTES + 1 }, pub)).toBeNull()
    expect(parseManifestPayload({ ...ok, key: generateSigningKey() }, pub)).toBeNull()
    expect(parseManifestPayload({ ...ok, encoding: 'brotli' }, pub)).toBeNull()
  })
})

describe('moving to another device', () => {
  it('round trip: the new device ends with the same wishes and lists, can republish a list, and the source sees "moved"', async () => {
    const { dev } = world()
    const source = dev('source')
    const { list } = await populate(source)
    const other = dev('friend')
    const theirs = await createSharedList(other, { name: 'Theirs' })
    await publishList(other, theirs.id)
    await addGuestListFromLink(source, buildShareLink(theirs, SITE))

    const out = await createTransfer(source, { siteBase: SITE })
    expect(out.url.startsWith(`${SITE}#/t/`)).toBe(true)
    expect(out.summary).toEqual({ items: 2, lists: 2, categories: 1 })
    expect(out.expiresAtMs - source.now()).toBe(TRANSFER_TTL_MS)
    // The secret travels only in the link: never in any event.
    for (const e of source.transport.network.store.all()) expect(JSON.stringify(e)).not.toContain(out.link.secret)
    const topic = deriveTransferKeys(out.link.secret).topic
    for (const e of source.transport.network.store.all().filter((x) => x.tags.some((t) => t[0] === 't' && t[1] === topic))) {
      expect(e.pubkey).toBe(out.link.pubkey)
      expect(e.tags.find((t) => t[0] === 'expiration')?.[1]).toBe(String(Math.floor(out.expiresAtMs / 1000)))
    }
    // Making a transfer is not a backup.
    expect((await getSettings(source.db)).lastExportAt).toBeUndefined()

    const states: OutgoingState[] = []
    const stop = watchTransfer(source, out, (s) => states.push(s))

    const target = dev('target')
    expect(await deviceHasData(target)).toBe(false)
    const incoming = await fetchTransfer(target, out.url)
    expect(incoming.summary).toEqual(out.summary)
    const result = await receiveTransfer(target, incoming)
    expect(result).toMatchObject({ items: 2, sharedLists: 1, guestLists: 1, cleared: true })
    expect(await target.db.items.toArray()).toEqual(await source.db.items.toArray())
    expect(await target.db.guestLists.toArray()).toEqual(await source.db.guestLists.toArray())
    expect((await getSettings(target.db)).ownerName).toBe('Ann')
    expect((await getSettings(target.db)).onboarding?.status).toBe('completed')

    // The new device holds working list keys: it can publish the list again under the same link.
    const moved = await getSharedList(target.db, list.id)
    expect(moved?.ownerSecretKey).toBe(list.ownerSecretKey)
    const report = await syncList(target, list.id, { force: true })
    expect(report.ok).toBe(true)

    await waitFor(() => states.includes('moved'))
    stop()

    // A second use after completion fails plainly.
    await expectFailure(fetchTransfer(dev('third'), out.url), 'used')
  })

  it('carries a payload over several chunks', async () => {
    const { dev } = world()
    const source = dev('source')
    await populate(source, { bigItems: 40 })
    const out = await createTransfer(source, { siteBase: SITE })
    expect(out.chunks).toBeGreaterThan(1)
    const target = dev('target')
    const incoming = await fetchTransfer(target, out.url)
    await receiveTransfer(target, incoming)
    expect(await target.db.items.count()).toBe(42)
  })

  it('an expired link is refused, before and after the wait', async () => {
    const { dev, clock } = world()
    const source = dev('source')
    await populate(source)
    const out = await createTransfer(source, { siteBase: SITE })
    clock.advance(TRANSFER_TTL_MS + 1000)
    await expectFailure(fetchTransfer(dev('target'), out.url), 'expired')
  })

  it('a cancelled transfer is refused, and the source sees it', async () => {
    const { dev } = world()
    const source = dev('source')
    await populate(source)
    const out = await createTransfer(source, { siteBase: SITE })
    expect(await cancelTransfer(source, out)).toBe(true)
    await expectFailure(fetchTransfer(dev('target'), out.url), 'cancelled')
    // Every chunk is emptied, and deletion requests were sent.
    const store = source.transport.network.store.all()
    const keys = deriveTransferKeys(out.link.secret)
    expect(store.filter((e) => e.tags.some((t) => t[0] === 'd' && t[1] === chunkSlot(keys.topic, 0)))[0]?.content).toBe('')
    expect(store.some((e) => e.kind === 5)).toBe(true)
  })

  it('missing chunks, a tampered chunk and a tampered manifest each fail with their own reason', async () => {
    const { dev } = world()
    const source = dev('source')
    await populate(source, { bigItems: 40 })
    const out = await createTransfer(source, { siteBase: SITE })
    const store = source.transport.network.store
    const keys = deriveTransferKeys(out.link.secret)
    const slotOf = (d: string) => store.all().find((e) => e.tags.some((t) => t[0] === 'd' && t[1] === d))

    // A chunk signed by the right key but with content that does not decrypt (or was swapped from another slot).
    const sign = { secretKey: out.secretKey, createdAt: out.createdAt + 1, expiresAt: out.link.expiresAt }
    const first = slotOf(chunkSlot(keys.topic, 0))!
    const swapped = finalizeEvent({ kind: HIPPO_KIND, created_at: sign.createdAt, tags: [['d', chunkSlot(keys.topic, 1)], ['t', keys.topic], ['expiration', String(sign.expiresAt)]], content: first.content }, hexToBytes(out.secretKey))
    expect(store.add(swapped)).toBe('stored')
    await expectFailure(fetchTransfer(dev('t1'), out.url), 'tampered')

    // Losing a chunk.
    store.delete(slotOf(chunkSlot(keys.topic, 1))!.id)
    await expectFailure(fetchTransfer(dev('t2'), out.url), 'missing')

    // A manifest whose hash does not match what the chunks hold.
    const source2 = dev('source2')
    await populate(source2)
    const out2 = await createTransfer(source2, { siteBase: SITE })
    const keys2 = deriveTransferKeys(out2.link.secret)
    const m = slotOf(manifestSlot(keys2.topic))!
    const bad = buildManifestEvent(keys2, { v: 1, kind: 'manifest', chunks: 1, length: out2.bytes, sha256: 'ab'.repeat(32), encoding: 'gzip', key: out2.secretKey }, { secretKey: out2.secretKey, createdAt: m.created_at + 1, expiresAt: out2.link.expiresAt })
    store.add(bad)
    await expectFailure(fetchTransfer(dev('t3'), out2.url), 'tampered')
  })

  it('ignores extra and forged events on the topic from anyone without the one-time key', async () => {
    const { dev } = world()
    const source = dev('source')
    await populate(source)
    const out = await createTransfer(source, { siteBase: SITE })
    const keys = deriveTransferKeys(out.link.secret)
    const store = source.transport.network.store
    // An attacker who learnt the topic (it is public on the relays) but not the secret or the key.
    const attacker = generateSigningKey()
    for (const d of [manifestSlot(keys.topic), chunkSlot(keys.topic, 0), chunkSlot(keys.topic, 1)]) {
      store.add(finalizeEvent({ kind: HIPPO_KIND, created_at: out.createdAt + 5, tags: [['d', d], ['t', keys.topic], ['expiration', String(out.link.expiresAt)]], content: 'AAAA' }, hexToBytes(attacker)))
    }
    // An event that claims the right key but carries someone else's signature.
    const forged = finalizeEvent({ kind: HIPPO_KIND, created_at: out.createdAt + 5, tags: [['d', manifestSlot(keys.topic)], ['t', keys.topic], ['expiration', String(out.link.expiresAt)]], content: '' }, hexToBytes(attacker))
    // A dishonest relay hands it out next to the real events (an honest one refuses it).
    const target = dev('target')
    const real = target.transport
    target.transports = () => ({
      publish: (e) => real.publish(e),
      fetch: (f) => real.fetch(f),
      close: () => real.close(),
      subscribe: (f, onEvent, onEose) => {
        onEvent({ ...forged, pubkey: out.link.pubkey })
        return real.subscribe(f, onEvent, onEose)
      },
    })
    const incoming = await fetchTransfer(target, out.url)
    await receiveTransfer(target, incoming)
    expect(await target.db.items.count()).toBe(2)
  })

  it('merges into a device that already has data and never replaces its lists', async () => {
    const { dev } = world()
    const source = dev('source')
    const { list } = await populate(source)
    const target = dev('target')
    await createItem(target.db, { title: 'Already here' })
    const own = await createSharedList(target, { name: 'Birthday' })
    // The same list already on the target (an earlier move): kept as it is.
    const first = await createTransfer(source, { siteBase: SITE })
    await receiveTransfer(target, await fetchTransfer(target, first.url))
    await target.db.sharedLists.update(list.id, { name: 'Renamed here' })
    const second = await createTransfer(source, { siteBase: SITE })
    expect(await deviceHasData(target)).toBe(true)
    const r = await receiveTransfer(target, await fetchTransfer(target, second.url))
    expect(r.skippedLists).toBe(1)
    expect((await getSharedList(target.db, list.id))?.name).toBe('Renamed here')
    expect((await target.db.items.toArray()).map((i) => i.title).sort()).toEqual(['A good book', 'Already here', 'Concert tickets'])
    expect(await getSharedList(target.db, own.id)).toBeDefined()
  })

  it('says so when no sync server answers, and when nothing is there', async () => {
    const { dev, network } = world()
    const target = dev('target')
    const link = `${SITE}#/t/${encodeTransferPayload({ secret: bytesToHex(randomBytes(32)), pubkey: publicKeyOf(generateSigningKey()), expiresAt: Math.floor(target.now() / 1000) + 600 })}`
    await expectFailure(fetchTransfer(target, link), 'not-found')
    target.transport.offline = true
    await expectFailure(fetchTransfer(target, link, { timeoutMs: 50 }), 'offline')
    expect(network.store.all()).toHaveLength(0)
    await flush()
  })

  it('validates the backup inside like a file import (hostile input)', async () => {
    const { dev } = world()
    const source = dev('source')
    await populate(source)
    const out = await createTransfer(source, { siteBase: SITE })
    const keys = deriveTransferKeys(out.link.secret)
    const store = source.transport.network.store
    // The holder of the link (who has the one-time key from the manifest) sends a payload that is not a backup.
    const { buildChunkEvent, sha256Hex } = await import('../protocol/transfer.ts')
    const junk = new TextEncoder().encode(JSON.stringify({ format: 'hippo-export', version: 2, items: [{ id: 'nope' }] }))
    const sign = { secretKey: out.secretKey, createdAt: out.createdAt + 1, expiresAt: out.link.expiresAt }
    store.add(buildChunkEvent(keys, 0, junk, sign))
    store.add(buildManifestEvent(keys, { v: 1, kind: 'manifest', chunks: 1, length: junk.length, sha256: sha256Hex(junk), encoding: 'none', key: out.secretKey }, sign))
    await expectFailure(fetchTransfer(dev('target'), out.url), 'invalid-backup')
  })
})

