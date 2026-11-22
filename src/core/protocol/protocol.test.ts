// @vitest-environment node
import { finalizeEvent } from 'nostr-tools/pure'
import { describe, expect, it } from 'vitest'
import { encryptJson } from '../crypto/aead.ts'
import { hexToBytes, randomId } from '../crypto/bytes.ts'
import { deriveListKeys, generateListSecret, generateSigningKey, publicKeyOf } from '../crypto/keys.ts'
import type { ClaimPayload, ItemPayload, ListMetaPayload } from '../model/types.ts'
import { buildClaimEvent, buildItemEvent, buildItemTombstone, buildMetaEvent, expirationFor, nextCreatedAt } from './build.ts'
import { ListState } from './list-state.ts'
import { receiveEvent } from './receive.ts'
import { HIPPO_KIND, claimSlot, itemSlot, metaSlot, parseSlot } from './slots.ts'

function setup() {
  const listSecret = generateListSecret()
  const ownerSk = generateSigningKey()
  const keys = deriveListKeys(listSecret)
  const ownerPubkey = publicKeyOf(ownerSk)
  const ctx = { topic: keys.topic, ownerPubkey, contentKey: keys.contentKey, claimsKey: keys.claimsKey }
  const meta: ListMetaPayload = { v: 1, name: 'Birthday', itemIds: [], showPrices: true, showNotes: true, status: 'published', updatedAt: 1 }
  const item = (id = randomId(), extra: Partial<ItemPayload> = {}): ItemPayload => ({
    v: 1, id, title: 'Hippo', quantity: 1, importance: 'love', allowContributions: false, updatedAt: 1, ...extra,
  })
  const claim = (extra: Partial<ClaimPayload> = {}): ClaimPayload => ({
    v: 1, id: randomId(), itemId: randomId(), kind: 'full', status: 'reserved', createdAt: 1, updatedAt: 1, ...extra,
  })
  const sign = (sk: string, createdAt = 1000) => ({ topic: keys.topic, secretKey: sk, createdAt })
  return { listSecret, ownerSk, keys, ownerPubkey, ctx, meta, item, claim, sign }
}

describe('slots', () => {
  it('parses only well-formed slots for the topic', () => {
    const t = 'ab'.repeat(32)
    const id = randomId()
    expect(parseSlot(metaSlot(t), t)).toEqual({ type: 'meta' })
    expect(parseSlot(itemSlot(t, id), t)).toEqual({ type: 'item', itemId: id })
    expect(parseSlot(claimSlot(t, id), t)).toEqual({ type: 'claim', claimId: id })
    expect(parseSlot(metaSlot('cd'.repeat(32)), t)).toBeNull()
    expect(parseSlot(`hippo:${t}:item:XYZ`, t)).toBeNull()
    expect(parseSlot(`hippo:${t}:claim:${id}:x`, t)).toBeNull()
  })
})

describe('build', () => {
  it('sets d, t and expiration tags', () => {
    const s = setup()
    const e = buildMetaEvent(s.meta, s.keys.contentKey, s.sign(s.ownerSk, 1_700_000_000))
    expect(e.kind).toBe(HIPPO_KIND)
    expect(e.tags).toEqual([
      ['d', metaSlot(s.keys.topic)],
      ['t', s.keys.topic],
      ['expiration', String(1_700_000_000 + 400 * 86400)],
    ])
  })

  it('computes expiration from the event date, never already expired', () => {
    const created = Date.UTC(2026, 0, 1) / 1000
    expect(expirationFor(created, '2026-12-24')).toBe(Date.UTC(2026, 11, 24) / 1000 + 180 * 86400)
    expect(expirationFor(created, '2020-01-01')).toBe(created + 30 * 86400)
  })

  it('makes replacement timestamps strictly increase', () => {
    expect(nextCreatedAt(5_000)).toBe(5)
    expect(nextCreatedAt(5_000, 5)).toBe(6)
    expect(nextCreatedAt(5_000, 9)).toBe(10)
    expect(nextCreatedAt(20_000, 9)).toBe(20)
  })
})

describe('receiveEvent', () => {
  it('accepts valid owner events and claims', () => {
    const s = setup()
    const m = receiveEvent(buildMetaEvent(s.meta, s.keys.contentKey, s.sign(s.ownerSk)), s.ctx)
    expect(m.ok && m.accepted.type).toBe('meta')
    const it = s.item()
    const i = receiveEvent(buildItemEvent(it, s.keys.contentKey, s.sign(s.ownerSk)), s.ctx)
    expect(i.ok && i.accepted.type === 'item' && i.accepted.payload).toEqual(it)
    const c = receiveEvent(buildClaimEvent(s.claim(), s.keys.claimsKey, s.sign(generateSigningKey())), s.ctx)
    expect(c.ok && c.accepted.type).toBe('claim')
  })

  it('accepts owner tombstones as removed items', () => {
    const s = setup()
    const r = receiveEvent(buildItemTombstone(randomId(), s.sign(s.ownerSk)), s.ctx)
    expect(r.ok && r.accepted.type === 'item' && r.accepted.payload).toBeNull()
  })

  it('rejects owner slots signed by anyone else (forged owner events)', () => {
    const s = setup()
    const attacker = generateSigningKey()
    expect(receiveEvent(buildMetaEvent(s.meta, s.keys.contentKey, s.sign(attacker)), s.ctx)).toEqual({ ok: false, reason: 'not-owner' })
    expect(receiveEvent(buildItemEvent(s.item(), s.keys.contentKey, s.sign(attacker)), s.ctx)).toEqual({ ok: false, reason: 'not-owner' })
    expect(receiveEvent(buildItemTombstone(randomId(), s.sign(attacker)), s.ctx)).toEqual({ ok: false, reason: 'not-owner' })
  })

  it('rejects a tampered signature, pubkey swap or content edit', () => {
    const s = setup()
    const e = buildMetaEvent(s.meta, s.keys.contentKey, s.sign(s.ownerSk))
    expect(receiveEvent({ ...e, content: e.content.slice(0, -4) + 'AAA=' }, s.ctx)).toEqual({ ok: false, reason: 'bad-signature' })
    const attackerEvent = buildMetaEvent(s.meta, s.keys.contentKey, s.sign(generateSigningKey()))
    expect(receiveEvent({ ...attackerEvent, pubkey: s.ownerPubkey }, s.ctx)).toEqual({ ok: false, reason: 'bad-signature' })
  })

  it('rejects the wrong topic, kind or slot', () => {
    const s = setup()
    const other = setup()
    expect(receiveEvent(buildMetaEvent(s.meta, other.keys.contentKey, other.sign(s.ownerSk)), s.ctx)).toEqual({ ok: false, reason: 'wrong-topic' })
    const wrongKind = finalizeEvent(
      { kind: 1, created_at: 1, tags: [['d', metaSlot(s.keys.topic)], ['t', s.keys.topic]], content: '' },
      hexToBytes(s.ownerSk),
    )
    expect(receiveEvent(wrongKind, s.ctx)).toEqual({ ok: false, reason: 'wrong-kind' })
    // Correct t tag but a d slot from another topic.
    const d = metaSlot(other.keys.topic)
    const wrongSlot = finalizeEvent(
      { kind: HIPPO_KIND, created_at: 1, tags: [['d', d], ['t', s.keys.topic]], content: encryptJson(s.keys.contentKey, s.meta, d) },
      hexToBytes(s.ownerSk),
    )
    expect(receiveEvent(wrongSlot, s.ctx)).toEqual({ ok: false, reason: 'bad-slot' })
    const twoTopics = finalizeEvent(
      { kind: HIPPO_KIND, created_at: 1, tags: [['d', metaSlot(s.keys.topic)], ['t', s.keys.topic], ['t', other.keys.topic]], content: '' },
      hexToBytes(s.ownerSk),
    )
    expect(receiveEvent(twoTopics, s.ctx)).toEqual({ ok: false, reason: 'wrong-topic' })
  })

  it('rejects ciphertext moved to another slot (AAD) and the wrong key', () => {
    const s = setup()
    const it = s.item()
    const good = buildItemEvent(it, s.keys.contentKey, s.sign(s.ownerSk))
    const otherId = randomId()
    const moved = finalizeEvent(
      { kind: HIPPO_KIND, created_at: 1, tags: [['d', itemSlot(s.keys.topic, otherId)], ['t', s.keys.topic]], content: good.content },
      hexToBytes(s.ownerSk),
    )
    expect(receiveEvent(moved, s.ctx)).toEqual({ ok: false, reason: 'decrypt-failed' })
    const claimWithContentKey = buildClaimEvent(s.claim(), s.keys.contentKey, s.sign(generateSigningKey()))
    expect(receiveEvent(claimWithContentKey, s.ctx)).toEqual({ ok: false, reason: 'decrypt-failed' })
  })

  it('rejects a payload id that does not match its slot', () => {
    const s = setup()
    const c = s.claim()
    const d = claimSlot(s.keys.topic, randomId())
    const e = finalizeEvent(
      { kind: HIPPO_KIND, created_at: 1, tags: [['d', d], ['t', s.keys.topic]], content: encryptJson(s.keys.claimsKey, c, d) },
      hexToBytes(generateSigningKey()),
    )
    expect(receiveEvent(e, s.ctx)).toEqual({ ok: false, reason: 'id-mismatch' })
  })

  it.each([
    ['title 201 chars', { title: 'x'.repeat(201) }],
    ['notes 2001 chars', { notes: 'x'.repeat(2001) }],
    ['url 2001 chars', { url: 'https://e.com/' + 'x'.repeat(1990) }],
    ['empty title', { title: '' }],
    ['zero quantity', { quantity: 0 }],
    ['fractional quantity', { quantity: 1.5 }],
    ['negative price', { price: { amount: -1, currency: 'EUR' } }],
    ['bad currency', { price: { amount: 1, currency: 'eur' } }],
    ['unknown importance', { importance: 'meh' }],
    ['wrong version', { v: 2 }],
  ])('rejects an item with %s', (_n, extra) => {
    const s = setup()
    const it = { ...s.item(), ...extra } as unknown as ItemPayload
    expect(receiveEvent(buildItemEvent(it, s.keys.contentKey, s.sign(s.ownerSk)), s.ctx)).toEqual({ ok: false, reason: 'invalid-payload' })
  })

  it.each([
    ['nickname 41 chars', { nickname: 'n'.repeat(41) }],
    ['pledge without amount', { kind: 'pledge' }],
    ['pledge of zero', { kind: 'pledge', amount: { amount: 0, currency: 'EUR' } }],
    ['full claim with amount', { amount: { amount: 5, currency: 'EUR' } }],
    ['unknown status', { status: 'stolen' }],
  ])('rejects a claim with %s', (_n, extra) => {
    const s = setup()
    const c = { ...s.claim(), ...extra } as unknown as ClaimPayload
    expect(receiveEvent(buildClaimEvent(c, s.keys.claimsKey, s.sign(generateSigningKey())), s.ctx)).toEqual({ ok: false, reason: 'invalid-payload' })
  })

  it('rejects oversized meta strings', () => {
    const s = setup()
    for (const extra of [{ name: 'n'.repeat(101) }, { message: 'm'.repeat(1001) }, { eventDate: '2026-02-30' }]) {
      const e = buildMetaEvent({ ...s.meta, ...extra }, s.keys.contentKey, s.sign(s.ownerSk))
      expect(receiveEvent(e, s.ctx)).toEqual({ ok: false, reason: 'invalid-payload' })
    }
  })

  it('counts emoji as one character and drops non-http URLs', () => {
    const s = setup()
    const it = s.item(randomId(), { title: '🦛'.repeat(200), url: 'javascript:alert(1)', imageUrl: 'data:image/png;base64,AAAA' })
    const r = receiveEvent(buildItemEvent(it, s.keys.contentKey, s.sign(s.ownerSk)), s.ctx)
    expect(r.ok).toBe(true)
    if (r.ok && r.accepted.type === 'item') {
      expect(r.accepted.payload?.url).toBeUndefined()
      expect(r.accepted.payload?.imageUrl).toBeUndefined()
    }
  })

  it('strips unknown fields from payloads', () => {
    const s = setup()
    const it = { ...s.item(), evil: '<script>' } as ItemPayload
    const r = receiveEvent(buildItemEvent(it, s.keys.contentKey, s.sign(s.ownerSk)), s.ctx)
    expect(r.ok && r.accepted.type === 'item' && r.accepted.payload && 'evil' in r.accepted.payload).toBe(false)
  })

  it('rejects malformed events and claims when there is no claims key', () => {
    const s = setup()
    expect(receiveEvent(null, s.ctx)).toEqual({ ok: false, reason: 'malformed' })
    expect(receiveEvent({ id: 'x' }, s.ctx)).toEqual({ ok: false, reason: 'malformed' })
    const c = buildClaimEvent(s.claim(), s.keys.claimsKey, s.sign(generateSigningKey()))
    expect(receiveEvent(c, { ...s.ctx, claimsKey: undefined })).toEqual({ ok: false, reason: 'no-claims-key' })
  })
})

describe('ListState', () => {
  it('keeps the newest event per slot; older events do not replace newer ones', () => {
    const s = setup()
    const state = new ListState(s.ctx)
    const newer = buildMetaEvent({ ...s.meta, name: 'new' }, s.keys.contentKey, s.sign(s.ownerSk, 2000))
    const older = buildMetaEvent({ ...s.meta, name: 'old' }, s.keys.contentKey, s.sign(s.ownerSk, 1000))
    expect(state.ingest(newer).outcome).toBe('accepted')
    expect(state.ingest(older).outcome).toBe('stale')
    expect(state.ingest(newer).outcome).toBe('duplicate')
    expect(state.meta?.payload.name).toBe('new')
  })

  it('breaks created_at ties by lower event id', () => {
    const s = setup()
    const a = buildMetaEvent({ ...s.meta, name: 'a' }, s.keys.contentKey, s.sign(s.ownerSk, 1000))
    const b = buildMetaEvent({ ...s.meta, name: 'b' }, s.keys.contentKey, s.sign(s.ownerSk, 1000))
    const [low, high] = a.id < b.id ? [a, b] : [b, a]
    const s1 = new ListState(s.ctx)
    s1.ingest(high)
    s1.ingest(low)
    const s2 = new ListState(s.ctx)
    s2.ingest(low)
    s2.ingest(high)
    expect(s1.meta?.event.id).toBe(low.id)
    expect(s2.meta?.event.id).toBe(low.id)
  })

  it('never lets a second pubkey overwrite a claim slot', () => {
    const s = setup()
    const alice = generateSigningKey()
    const mallory = generateSigningKey()
    const claim = s.claim()
    const state = new ListState(s.ctx)
    expect(state.ingest(buildClaimEvent(claim, s.keys.claimsKey, s.sign(alice, 1000))).outcome).toBe('accepted')
    // Same slot and id, newer and even backdated: both refused.
    const hijack = { ...claim, status: 'withdrawn' as const }
    expect(state.ingest(buildClaimEvent(hijack, s.keys.claimsKey, s.sign(mallory, 5000))).outcome).toBe('slot-taken')
    expect(state.ingest(buildClaimEvent(hijack, s.keys.claimsKey, s.sign(mallory, 10))).outcome).toBe('slot-taken')
    expect(state.claims()[0]?.payload.status).toBe('reserved')
    // The slot owner can still edit.
    expect(state.ingest(buildClaimEvent({ ...claim, status: 'purchased' }, s.keys.claimsKey, s.sign(alice, 1001))).outcome).toBe('accepted')
    expect(state.claims()[0]?.payload.status).toBe('purchased')
  })

  it('resolves competing slot authors in one batch by lower created_at, then lower id', () => {
    const s = setup()
    const claim = s.claim()
    const first = buildClaimEvent(claim, s.keys.claimsKey, s.sign(generateSigningKey(), 1000))
    const second = buildClaimEvent(claim, s.keys.claimsKey, s.sign(generateSigningKey(), 1001))
    for (const order of [[first, second], [second, first]]) {
      const state = new ListState(s.ctx)
      state.ingestBatch(order)
      expect(state.claims()[0]?.event.pubkey).toBe(first.pubkey)
    }
  })
})
