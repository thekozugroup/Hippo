// @vitest-environment node
// "Your Hippo account" over the in-memory transport: two and three simulated devices, each with its
// own database and clock, sharing one network (PROTOCOL.md section 12).

import { afterEach, describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import { openDb } from '../db/schema.ts'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { encryptJson } from '../crypto/aead.ts'
import { bytesToHex, hexToBytes, randomId } from '../crypto/bytes.ts'
import { deriveContentKeys, topicForSecret } from '../crypto/keys.ts'
import { getCachedEvents } from '../db/event-cache.ts'
import { getSettings, setOnboarding, setOwnerName } from '../db/settings.ts'
import { HIPPO_KIND } from '../protocol/slots.ts'
import { expirationOf } from '../protocol/build.ts'
import { exportData, importData } from '../services/backup.ts'
import { addGuestListFromLink, openGuestList, type GiverListSession } from '../services/giver-lists.ts'
import { buildShareLink, createSharedList, deleteSharedList, publishList, rotateList, sharedItemIdFor, syncList, topicOfList, updateSharedList } from '../services/owner-lists.ts'
import { createTransfer, fetchTransfer, receiveTransfer } from '../services/transfer.ts'
import { createCategory, createItem, deleteItem, getItem, listItems, mergeItemEdit, updateItem } from '../services/wishlist.ts'
import { flush, testClock, testDevice, waitFor, type TestClock, type TestDevice } from '../testing/fixtures.ts'
import { MemoryNetwork } from '../transport/memory.ts'
import { isTransferError } from '../protocol/transfer.ts'
import { deriveAccountKeys, generateAccountSecret } from './keys.ts'
import { formatRecoveryCode, parseRecoveryCode, recoveryWords } from './recovery-code.ts'
import { accountSlot, acceptAccountEvent, buildRecordEvent, mergeStates, type RecordState } from './records.ts'
import { accountSecret, accountSummary, changeRecoveryCode, ensureAccount, setAccountSync, signInToAccount, signOutOfAccount } from './service.ts'
import { getAccountState } from './state.ts'
import { AccountSync, accountFilter, runAccountSync } from './sync.ts'

const BASE = 'https://hippo.example/app/'
const FAST = { fetchTimeoutMs: 60 }
const sessions: GiverListSession[] = []
const engines: AccountSync[] = []

afterEach(() => {
  for (const s of sessions.splice(0)) s.stop()
  for (const e of engines.splice(0)) e.stop()
})

function device(network: MemoryNetwork, name: string, clock: TestClock = testClock()): TestDevice {
  return testDevice(network, clock, name)
}

const sync = (d: TestDevice, fetch: 'auto' | 'full' | 'none' = 'auto') => runAccountSync(d, { ...FAST, fetch })

/** Runs passes on every device until a round publishes nothing (and fails if that never happens: ping-pong). */
async function converge(...devices: TestDevice[]): Promise<number> {
  for (let round = 0; round < 8; round++) {
    let published = 0
    for (const d of devices) published += (await sync(d)).published
    if (published === 0) return round
  }
  throw new Error('devices kept writing: no convergence')
}

async function titles(d: TestDevice): Promise<string[]> {
  return (await listItems(d.db, { includeArchived: true })).map((i) => i.title).sort()
}

async function accountDevice(network: MemoryNetwork, name: string) {
  const d = device(network, name)
  const secret = await ensureAccount(d)
  return { d, secret }
}

function countAccountEvents(network: MemoryNetwork, pubkey: string): number {
  return network.store.query({ kinds: [HIPPO_KIND], authors: [pubkey] }).length
}

describe('recovery code', () => {
  it('round-trips 128 bits through 13 words, and reads sloppy input', () => {
    for (let i = 0; i < 50; i++) {
      const secret = generateAccountSecret()
      const words = recoveryWords(secret)
      expect(words).toHaveLength(13)
      expect(parseRecoveryCode(words.join(' '))).toEqual({ ok: true, secret })
      const sloppy = words.map((w, j) => `${j + 1}. ${w.toUpperCase()}`).join(',\n  ')
      expect(parseRecoveryCode(sloppy)).toEqual({ ok: true, secret })
      // Each word by its first four letters, and a misspelt ending, still work.
      expect(parseRecoveryCode(words.map((w) => (w.length > 4 ? w.slice(0, 4) : w)).join(' '))).toEqual({ ok: true, secret })
    }
  })

  it('rejects the wrong number of words, unknown words and typos through the checksum', () => {
    const secret = '00112233445566778899aabbccddeeff'
    const words = recoveryWords(secret)
    expect(parseRecoveryCode(words.slice(0, 12).join(' '))).toMatchObject({ ok: false, reason: 'count', count: 12 })
    expect(parseRecoveryCode([...words.slice(0, 12), 'qqqq'].join(' '))).toMatchObject({ ok: false, reason: 'word', position: 13 })
    // Every single-word substitution with a valid word is caught.
    let caught = 0
    for (let pos = 0; pos < 13; pos++) {
      for (const sub of ['zoo', 'apple', 'wolf', 'cabin']) {
        if (words[pos] === sub) continue
        const typo = [...words]
        typo[pos] = sub
        const r = parseRecoveryCode(typo.join(' '))
        expect(r.ok).toBe(false)
        caught++
      }
    }
    expect(caught).toBeGreaterThan(40)
    // Two neighbouring words swapped.
    for (let pos = 0; pos < 12; pos++) {
      if (words[pos] === words[pos + 1]) continue
      const swapped = [...words]
      ;[swapped[pos], swapped[pos + 1]] = [words[pos + 1] ?? '', words[pos] ?? '']
      expect(parseRecoveryCode(swapped.join(' ')).ok).toBe(false)
    }
    expect(formatRecoveryCode(secret).split(' ')).toEqual(words)
  })

  it('derives keys under labels no list or transfer derivation uses', () => {
    const secret = generateAccountSecret()
    const k = deriveAccountKeys(secret)
    const padded = secret + secret
    expect(k.topic).not.toBe(topicForSecret(padded))
    expect(bytesToHex(k.contentKey)).not.toBe(bytesToHex(deriveContentKeys(padded).contentKey))
    expect(new Set([k.topic, bytesToHex(k.contentKey), bytesToHex(k.slotKey), k.secretKey]).size).toBe(4)
  })
})

describe('account sync between devices', () => {
  it('creates on A, signs in on B by code, and both converge on wishes, categories, lists and the profile', async () => {
    const network = new MemoryNetwork()
    const { d: a, secret } = await accountDevice(network, 'a')
    const cat = await createCategory(a.db, 'Books')
    const wish = await createItem(a.db, { title: 'Scarf', categoryIds: [cat.id], price: { amount: 2500, currency: 'EUR' } }, a.now())
    const list = await createSharedList(a, { name: 'Birthday', itemIds: [wish.id] })
    await setOwnerName(a.db, 'Ann')
    await setOnboarding(a.db, { status: 'completed', step: 0, answers: {}, updatedAt: a.now() })
    expect((await sync(a)).state).toBe('ok')

    const b = device(network, 'b')
    const code = formatRecoveryCode(secret)
    const parsed = parseRecoveryCode(code)
    if (!parsed.ok) throw new Error('code')
    expect(await signInToAccount(b, parsed.secret, { codeSaved: true })).toBe('signed-in')
    await converge(a, b)

    expect(await titles(b)).toEqual(['Scarf'])
    expect((await b.db.categories.toArray()).map((c) => c.name)).toEqual(['Books'])
    const bList = await b.db.sharedLists.get(list.id)
    expect(bList).toMatchObject({ name: 'Birthday', listSecret: list.listSecret, ownerSecretKey: list.ownerSecretKey, itemIds: [wish.id] })
    expect((await getSettings(b.db)).ownerName).toBe('Ann')
    expect((await getSettings(b.db)).onboarding?.status).toBe('completed')
    // Signing in by code counts as having saved it, and that syncs back to A.
    await converge(a, b)
    expect((await accountSummary(a.db)).recoverySavedAt).toBeDefined()
  })

  it('edits and deletions travel both ways, and a deleted wish never comes back', async () => {
    const network = new MemoryNetwork()
    const { d: a, secret } = await accountDevice(network, 'a')
    const one = await createItem(a.db, { title: 'One' }, a.now())
    const two = await createItem(a.db, { title: 'Two' }, a.now())
    await sync(a)
    const b = device(network, 'b')
    await signInToAccount(b, secret)
    const c = device(network, 'c')
    await signInToAccount(c, secret)
    await converge(a, b, c)

    a.clock.advance(1000)
    await updateItem(a.db, one.id, { title: 'One, edited' }, a.now())
    await converge(a, b, c)
    expect(await titles(b)).toEqual(['One, edited', 'Two'])

    b.clock.advance(2000)
    await deleteItem(b.db, two.id, b.now())
    // C is offline while B deletes, holding the wish.
    c.transport.offline = true
    await converge(a, b)
    expect(await getItem(a.db, two.id)).toBeUndefined()
    // C edits the deleted wish offline, then comes back: deletion is final, everywhere.
    c.clock.advance(5000)
    await updateItem(c.db, two.id, { title: 'Two, edited offline' }, c.now())
    await sync(c)
    c.transport.offline = false
    await converge(a, b, c)
    for (const d of [a, b, c]) expect(await titles(d)).toEqual(['One, edited'])
    const tomb = await a.db.accountRecords.where('type').equals('wish').filter((r) => r.id === two.id).first()
    expect(tomb?.del).toBeDefined()
  })

  it('offline edits to different fields of the same wish are both kept; the same field takes the later edit', async () => {
    const network = new MemoryNetwork()
    const { d: a, secret } = await accountDevice(network, 'a')
    const w = await createItem(a.db, { title: 'Bike', notes: 'Blue' }, a.now())
    await sync(a)
    const b = device(network, 'b')
    await signInToAccount(b, secret)
    await converge(a, b)

    a.transport.offline = true
    b.transport.offline = true
    a.clock.advance(1000)
    b.clock.advance(2000)
    await mergeItemEdit(a.db, w.id, { title: 'Road bike', notes: 'Red' }, { title: 'Bike', notes: 'Blue' }, a.now())
    await mergeItemEdit(b.db, w.id, { price: { amount: 30000, currency: 'EUR' }, notes: 'Green' }, { notes: 'Blue' }, b.now())
    expect((await sync(a)).state).toBe('offline')
    expect((await sync(b)).state).toBe('offline')
    a.transport.offline = false
    b.transport.offline = false
    await converge(a, b)
    for (const d of [a, b]) {
      const item = await getItem(d.db, w.id)
      expect(item).toMatchObject({ title: 'Road bike', price: { amount: 30000, currency: 'EUR' }, notes: 'Green' })
    }
  })

  it('two live engines converge without ping-pong', async () => {
    const network = new MemoryNetwork()
    const { d: a, secret } = await accountDevice(network, 'a')
    await createItem(a.db, { title: 'Lamp' }, a.now())
    const b = device(network, 'b')
    await signInToAccount(b, secret)
    const ea = new AccountSync(a, { debounceMs: 20, ...FAST })
    const eb = new AccountSync(b, { debounceMs: 20, ...FAST })
    engines.push(ea, eb)
    ea.start()
    eb.start()
    await ea.syncNow()
    await eb.syncNow()
    await ea.syncNow()
    const w = await createItem(a.db, { title: 'Kettle' }, a.now())
    // A's change goes out by itself (coalesced local change), and B receives it live.
    let seen = false
    for (let i = 0; i < 200 && !seen; i++) {
      await new Promise((r) => setTimeout(r, 10))
      seen = (await getItem(b.db, w.id)) !== undefined
    }
    expect(seen).toBe(true)
    await ea.idle()
    await eb.idle()
    const pub = deriveAccountKeys(secret).pubkey
    const before = network.store.query({ authors: [pub] }).map((e) => e.id).sort()
    await new Promise((r) => setTimeout(r, 150))
    await ea.syncNow()
    await eb.syncNow()
    await ea.idle()
    await eb.idle()
    expect(network.store.query({ authors: [pub] }).map((e) => e.id).sort()).toEqual(before)
    expect(eb.getStatus().state).toBe('ok')
  })

  it('a device link signs the other device in, carries a snapshot, works once and expires', async () => {
    const clock = testClock()
    const network = new MemoryNetwork({ nowSeconds: () => Math.floor(clock.now() / 1000) })
    const a = device(network, 'a', clock)
    const secret = await ensureAccount(a)
    await createItem(a.db, { title: 'Tent' }, a.now())
    await sync(a)
    const t = await createTransfer(a, { siteBase: BASE, account: secret })
    const b = device(network, 'b', clock)
    const incoming = await fetchTransfer(b, t.url, { timeoutMs: 200 })
    expect(incoming.account).toBe(secret)
    const r = await receiveTransfer(b, incoming)
    expect(r.signedIn).toBe(true)
    expect(await titles(b)).toEqual(['Tent']) // usable before the first sync
    expect(await accountSecret(b.db)).toBe(secret)
    await converge(a, b)
    // Snapshot and sync agree: nothing was duplicated or re-stamped.
    expect(await titles(b)).toEqual(['Tent'])

    const c = device(network, 'c', testClock())
    await expect(fetchTransfer(c, t.url, { timeoutMs: 200 })).rejects.toSatisfy((e: unknown) => isTransferError(e, 'used'))

    const t2 = await createTransfer(a, { siteBase: BASE, account: secret })
    c.clock.advance(16 * 60 * 1000)
    await expect(fetchTransfer(c, t2.url, { timeoutMs: 200 })).rejects.toSatisfy((e: unknown) => isTransferError(e, 'expired'))
  })

  it('a device link for another account is refused on a signed-in device', async () => {
    const clock = testClock()
    const network = new MemoryNetwork({ nowSeconds: () => Math.floor(clock.now() / 1000) })
    const a = device(network, 'a', clock)
    const secret = await ensureAccount(a)
    await sync(a)
    const b = device(network, 'b', clock)
    await ensureAccount(b)
    const t = await createTransfer(a, { siteBase: BASE, account: secret })
    const incoming = await fetchTransfer(b, t.url, { timeoutMs: 200 })
    await expect(receiveTransfer(b, incoming)).rejects.toSatisfy((e: unknown) => isTransferError(e, 'other-account'))
    expect(await titles(b)).toEqual([])
  })

  it('signing in on a device that already has data merges without loss; duplicates by id collapse', async () => {
    const network = new MemoryNetwork()
    const { d: a, secret } = await accountDevice(network, 'a')
    const shared = await createItem(a.db, { title: 'Shared wish' }, a.now())
    await createItem(a.db, { title: 'Only on A' }, a.now())
    await sync(a)
    const b = device(network, 'b')
    // B restored the same wish from a backup earlier, and has its own.
    await importData(b.db, await exportData(a.db, a.now(), { record: false }), { mode: 'merge', now: b.now() })
    await createItem(b.db, { title: 'Only on B' }, b.now())
    await setOwnerName(b.db, 'Bea')
    await signInToAccount(b, secret)
    await converge(a, b)
    for (const d of [a, b]) expect(await titles(d)).toEqual(['Only on A', 'Only on B', 'Shared wish'])
    expect((await listItems(b.db)).filter((i) => i.id === shared.id)).toHaveLength(1)
    // A field only B had fills the gap.
    expect((await getSettings(a.db)).ownerName).toBe('Bea')
  })

  it('nothing is sent before the first merge; offline sign-in waits', async () => {
    const network = new MemoryNetwork()
    const { d: a, secret } = await accountDevice(network, 'a')
    await createItem(a.db, { title: 'From A' }, a.now())
    await sync(a)
    const b = device(network, 'b')
    await createItem(b.db, { title: 'From B' }, b.now())
    await signInToAccount(b, secret)
    b.transport.offline = true
    const out = await sync(b)
    expect(out).toMatchObject({ state: 'offline', pending: true, published: 0 })
    b.transport.offline = false
    await converge(a, b)
    expect(await titles(a)).toEqual(['From A', 'From B'])
  })
})

describe('lists and gifts after signing in', () => {
  it('a list made on A is edited and republished on B; its link still opens for a giver; B never asks for claims', async () => {
    const network = new MemoryNetwork()
    const { d: a, secret } = await accountDevice(network, 'a')
    const scarf = await createItem(a.db, { title: 'Scarf' }, a.now())
    const list = await createSharedList(a, { name: 'Birthday', itemIds: [scarf.id] })
    await publishList(a, list.id)
    await sync(a)
    const b = device(network, 'b')
    await signInToAccount(b, secret)
    await converge(a, b)
    await flush()

    // A giver opens the link and says "I'll get this".
    const giverDev = device(network, 'giver')
    const g = await addGuestListFromLink(giverDev, buildShareLink(list, BASE))
    const gs = await openGuestList(giverDev, g.topic, { eoseTimeoutMs: 200, retryMs: 100 })
    sessions.push(gs)
    await gs.start()
    await waitFor(() => gs.getSnapshot().status === 'live')
    await gs.claim(sharedItemIdFor(list, scarf.id))

    // B renames the list and republishes it under the same link.
    b.clock.advance(60_000)
    await updateSharedList(b, list.id, { name: 'Birthday, from B' })
    const report = await syncList(b, list.id)
    expect(report.ok).toBe(true)
    await waitFor(() => gs.getSnapshot().meta?.name === 'Birthday, from B')
    expect(gs.getSnapshot().items[0]?.state.grantedQuantity).toBe(1)

    // A gets the rename through the account, without republishing an older version.
    await converge(a, b)
    expect((await a.db.sharedLists.get(list.id))?.name).toBe('Birthday, from B')
    await syncList(a, list.id)
    await flush()
    expect(gs.getSnapshot().meta?.name).toBe('Birthday, from B')

    // The owner rule holds on every signed-in device: no list filter without the owner key, no claims cached.
    const ownerPub = deriveContentKeys(list.listSecret).topic
    for (const d of [a, b]) {
      for (const f of d.transport.filterLog) {
        const topics = (f['#t'] as string[] | undefined) ?? []
        if (topics.includes(ownerPub)) expect(f.authors).toBeDefined()
        expect(f.authors?.length ?? 0).toBeGreaterThan(0)
      }
      const cached = await getCachedEvents(d.db, topicOfList(list))
      expect(cached.every((r) => !r.d.includes(':claim:'))).toBe(true)
    }
  })

  it('rotation on A moves to B; the old link is retired there too, never lost', async () => {
    const network = new MemoryNetwork()
    const { d: a, secret } = await accountDevice(network, 'a')
    const w = await createItem(a.db, { title: 'Book' }, a.now())
    const list = await createSharedList(a, { name: 'Xmas', itemIds: [w.id] })
    await publishList(a, list.id)
    const b = device(network, 'b')
    await sync(a)
    await signInToAccount(b, secret)
    await converge(a, b)
    a.clock.advance(1000)
    const { list: rotated } = await rotateList(a, list.id)
    await converge(a, b)
    const bl = await b.db.sharedLists.get(list.id)
    expect(bl?.listSecret).toBe(rotated.listSecret)
    expect(await b.db.sharedLists.count()).toBe(1)
    expect(await b.db.retiredLists.get(topicOfList(list))).toBeDefined()
  })

  it('the same list with different keys on two devices is kept twice, never overwritten', async () => {
    const network = new MemoryNetwork()
    const { d: a, secret } = await accountDevice(network, 'a')
    const list = await createSharedList(a, { name: 'Trip' })
    await publishList(a, list.id)
    const b = device(network, 'b')
    await importData(b.db, await exportData(a.db, a.now(), { record: false }), { mode: 'merge', now: b.now() })
    // Both rotate on their own, before B signs in.
    a.clock.advance(1000)
    const ra = (await rotateList(a, list.id)).list
    b.clock.advance(2000)
    const rb = (await rotateList(b, list.id)).list
    await sync(a)
    await signInToAccount(b, secret)
    await converge(a, b)
    for (const d of [a, b]) {
      const secrets = (await d.db.sharedLists.toArray()).map((l) => l.listSecret).sort()
      expect(secrets).toEqual([ra.listSecret, rb.listSecret].sort())
    }
  })

  it('gifts marked on A can be changed on B', async () => {
    const network = new MemoryNetwork()
    const owner = device(network, 'owner')
    const toy = await createItem(owner.db, { title: 'Toy' }, owner.now())
    const list = await createSharedList(owner, { name: 'Kid', itemIds: [toy.id] })
    await publishList(owner, list.id)
    const link = buildShareLink(list, BASE)

    const { d: a, secret } = await accountDevice(network, 'a')
    const g = await addGuestListFromLink(a, link)
    const sa = await openGuestList(a, g.topic, { eoseTimeoutMs: 200, retryMs: 100 })
    sessions.push(sa)
    await sa.start()
    await waitFor(() => sa.getSnapshot().status === 'live')
    await sa.setNickname('Aunt A')
    const { claim } = await sa.claim(sharedItemIdFor(list, toy.id))
    await sync(a)

    const b = device(network, 'b')
    await signInToAccount(b, secret)
    await converge(a, b)
    const sb = await openGuestList(b, g.topic, { eoseTimeoutMs: 200, retryMs: 100 })
    sessions.push(sb)
    await sb.start()
    await waitFor(() => sb.getSnapshot().status === 'live' && sb.getSnapshot().items.length > 0)
    const row = sb.getSnapshot().items[0]?.state.rows[0]
    expect(row).toMatchObject({ mine: true, nickname: 'Aunt A' })
    b.clock.advance(5000)
    await sb.markPurchased(claim.id)
    await waitFor(() => sa.getSnapshot().items[0]?.state.status === 'purchased')
  })

  it('a device that opened its own list as a giver drops it, and its cached claims, when it signs in', async () => {
    const network = new MemoryNetwork()
    const { d: a, secret } = await accountDevice(network, 'a')
    const w = await createItem(a.db, { title: 'Hat' }, a.now())
    const list = await createSharedList(a, { name: 'Mine', itemIds: [w.id] })
    await publishList(a, list.id)
    await sync(a)
    const someone = device(network, 'someone')
    const sg = await addGuestListFromLink(someone, buildShareLink(list, BASE))
    const ss = await openGuestList(someone, sg.topic, { eoseTimeoutMs: 200, retryMs: 100 })
    sessions.push(ss)
    await ss.start()
    await waitFor(() => ss.getSnapshot().status === 'live')
    await ss.claim(sharedItemIdFor(list, w.id))

    const c = device(network, 'c')
    const cg = await addGuestListFromLink(c, buildShareLink(list, BASE))
    const cs = await openGuestList(c, cg.topic, { eoseTimeoutMs: 200, retryMs: 100 })
    await cs.start()
    await waitFor(() => cs.getSnapshot().status === 'live' && cs.getSnapshot().items[0]?.state.grantedQuantity === 1)
    cs.stop()
    expect((await getCachedEvents(c.db, topicOfList(list))).some((r) => r.d.includes(':claim:'))).toBe(true)

    await signInToAccount(c, secret)
    await converge(a, c)
    expect(await c.db.guestLists.get(topicOfList(list))).toBeUndefined()
    // Only the owner's own events may be cached for it now (primed for republishing), never a claim.
    expect((await getCachedEvents(c.db, topicOfList(list))).some((r) => r.d.includes(':claim:'))).toBe(false)
    expect(await c.db.sharedLists.get(list.id)).toBeDefined()
    await expect(addGuestListFromLink(c, buildShareLink(list, BASE))).rejects.toThrow()
    // And A never received a guest record for its own list.
    expect(await a.db.guestLists.count()).toBe(0)
  })

  it('deleting a list on A retires it on B as well', async () => {
    const network = new MemoryNetwork()
    const { d: a, secret } = await accountDevice(network, 'a')
    const list = await createSharedList(a, { name: 'Gone' })
    await publishList(a, list.id)
    await sync(a)
    const b = device(network, 'b')
    await signInToAccount(b, secret)
    await converge(a, b)
    a.clock.advance(1000)
    await deleteSharedList(a, list.id)
    await converge(a, b)
    expect(await b.db.sharedLists.count()).toBe(0)
    expect(await b.db.retiredLists.get(topicOfList(list))).toMatchObject({ listId: list.id })
  })
})

describe('hostile input', () => {
  async function setup() {
    const network = new MemoryNetwork()
    const { d: a, secret } = await accountDevice(network, 'a')
    const w = await createItem(a.db, { title: 'Original' }, a.now())
    await sync(a)
    const b = device(network, 'b')
    await signInToAccount(b, secret)
    await converge(a, b)
    return { network, a, b, secret, w, keys: deriveAccountKeys(secret) }
  }

  it('ignores forged, wrong-key, tampered, oversized and misplaced events', async () => {
    const { network, b, keys, w } = await setup()
    const d = accountSlot(keys, 'wish', w.id)
    const evil = generateSecretKey()
    const payload = { v: 1, type: 'wish', id: w.id, data: { title: 'Hacked', quantity: 1, importance: 'want', categoryIds: [], allowContributions: false, createdAt: 1, updatedAt: 1 }, f: Object.fromEntries(['title', 'quantity', 'importance', 'categoryIds', 'allowContributions', 'createdAt', 'updatedAt'].map((k) => [k, [9e12, 'f'.repeat(32)]])) }
    const tags = [['d', d], ['t', keys.topic], ['expiration', String(2e9)]]
    const now = Math.floor(b.now() / 1000) + 10
    // An attacker who knows the topic (and even the slot) but not the secret: own key, and the right content key is unknown.
    const forged = finalizeEvent({ kind: HIPPO_KIND, created_at: now, tags, content: encryptJson(hexToBytes(randomId() + randomId()), payload, d) }, evil)
    // A valid event with its content changed after signing.
    const good = buildRecordEvent(keys, { ...(payload as unknown as Parameters<typeof buildRecordEvent>[1]), f: { title: [b.now() + 1, 'f'.repeat(32)] }, data: { title: 'x' } } as never, now)
    const tampered = good ? { ...good, content: good.content.slice(0, -4) + 'AAAA' } : null
    // An oversized event signed by the account key (a buggy device): refused by size.
    const big = finalizeEvent({ kind: HIPPO_KIND, created_at: now, tags, content: 'A'.repeat(70_000) }, hexToBytes(keys.secretKey))
    // A correctly signed record put in another record's slot.
    const other = await createItem(b.db, { title: 'Other' }, b.now())
    const moved = finalizeEvent({ kind: HIPPO_KIND, created_at: now, tags: [['d', accountSlot(keys, 'wish', other.id)], ['t', keys.topic], ['expiration', String(2e9)]], content: encryptJson(keys.contentKey, payload, d) }, hexToBytes(keys.secretKey))
    for (const e of [forged, tampered, big, moved]) expect(e === null ? null : acceptAccountEvent(e, keys, b.now())).toBeNull()
    const out = await runAccountSync(b, { events: [forged, tampered, big, moved] })
    expect(out.applied).toBe(0)
    expect((await getItem(b.db, w.id))?.title).toBe('Original')
    expect(network).toBeDefined()
  })

  it('a replayed or rolled-back version changes nothing, and the newer one is sent again', async () => {
    const { network, a, b, keys, w } = await setup()
    const d = accountSlot(keys, 'wish', w.id)
    const old = network.store.query({ authors: [keys.pubkey], '#d': [d] })[0]
    if (!old) throw new Error('no event')
    a.clock.advance(1000)
    await updateItem(a.db, w.id, { title: 'Newer' }, a.now())
    await converge(a, b)
    const out = await runAccountSync(b, { events: [old, old] })
    expect(out.applied).toBe(0)
    expect((await getItem(b.db, w.id))?.title).toBe('Newer')
    // A relay that rolled the slot back to the old event gets the newer version again on the next full fetch.
    for (const e of network.store.query({ authors: [keys.pubkey], '#d': [d] })) network.store.delete(e.id)
    expect(network.store.add(old)).toBe('stored')
    expect((await runAccountSync(a, { ...FAST, fetch: 'full' })).published).toBe(1)
    const back = network.store.query({ authors: [keys.pubkey], '#d': [d] })[0]
    expect(back && acceptAccountEvent(back, keys, a.now())?.payload).toMatchObject({ data: { title: 'Newer' } })
    expect((await getItem(a.db, w.id))?.title).toBe('Newer')
  })

  it('an attacker who knows only the topic can read nothing and change nothing', async () => {
    const { network, b, keys } = await setup()
    const events = network.store.query({ '#t': [keys.topic] })
    expect(events.length).toBeGreaterThan(0)
    for (const e of events) {
      expect(e.pubkey).toBe(keys.pubkey)
      // Opaque slots: no type, no id.
      expect(e.tags.find((t) => t[0] === 'd')?.[1]).toMatch(/^hippo-acct:[0-9a-f]{64}:[0-9a-f]{32}$/)
      expect(e.content).not.toContain('Original')
    }
    // A "retired" marker from someone else is ignored.
    const evil = generateSecretKey()
    const marker = finalizeEvent({ kind: HIPPO_KIND, created_at: Math.floor(b.now() / 1000), tags: [['d', `hippo-acct:${keys.topic}:${'0'.repeat(32)}`], ['t', keys.topic]], content: '' }, evil)
    await runAccountSync(b, { events: [marker] })
    expect((await accountSummary(b.db)).phase).toBe('on')
  })

  it('merging is order-independent and idempotent', () => {
    const dev1 = '1'.repeat(32)
    const dev2 = '2'.repeat(32)
    const x: RecordState = { data: { title: 'A', notes: 'n' }, f: { title: [5, dev1], notes: [1, dev1] } }
    const y: RecordState = { data: { title: 'B' }, f: { title: [5, dev2], notes: [3, dev2] } }
    expect(mergeStates('wish', x, y)).toEqual(mergeStates('wish', y, x))
    expect(mergeStates('wish', x, mergeStates('wish', x, y))).toEqual(mergeStates('wish', x, y))
    expect(mergeStates('wish', x, y)).toEqual({ data: { title: 'B' }, f: { title: [5, dev2], notes: [3, dev2] } })
  })
})

describe('keeping it alive, changing the code, signing out', () => {
  it('re-signs records that would expire, and fetches only what is new after the first time', async () => {
    const network = new MemoryNetwork()
    const { d: a, secret } = await accountDevice(network, 'a')
    const w = await createItem(a.db, { title: 'Old' }, a.now())
    await sync(a)
    const keys = deriveAccountKeys(secret)
    const d = accountSlot(keys, 'wish', w.id)
    const first = network.store.query({ authors: [keys.pubkey], '#d': [d] })[0]
    const exp1 = first ? expirationOf(first) : 0
    await sync(a)
    expect(a.transport.filterLog.at(-1)?.since).toBeDefined()
    a.clock.advance(400 * 24 * 3600 * 1000)
    await sync(a)
    const now = network.store.query({ authors: [keys.pubkey], '#d': [d] })[0]
    expect(now && first && now.created_at > first.created_at).toBe(true)
    expect((now ? expirationOf(now) : 0) ?? 0).toBeGreaterThan(exp1 ?? 0)
  })

  it('changing the recovery code moves everything to the new code and tells old devices to sign in again', async () => {
    const network = new MemoryNetwork()
    const { d: a, secret } = await accountDevice(network, 'a')
    await createItem(a.db, { title: 'Kept' }, a.now())
    await sync(a)
    const b = device(network, 'b')
    await signInToAccount(b, secret)
    await converge(a, b)

    a.clock.advance(1000)
    const fresh = await changeRecoveryCode(a)
    expect(fresh).not.toBe(secret)
    await sync(a)
    expect((await getAccountState(a.db))?.retiring).toBeUndefined()
    // B, still on the old code, stops.
    expect((await sync(b)).state).toBe('replaced')
    expect((await accountSummary(b.db)).phase).toBe('replaced')
    expect(await titles(b)).toEqual(['Kept'])
    // A replaced device never quietly starts a second account.
    await expect(ensureAccount(b)).rejects.toThrow('replaced')
    // Old records are emptied on the sync servers.
    const old = deriveAccountKeys(secret)
    const left = network.store.query({ authors: [old.pubkey] }).filter((e) => e.content !== '')
    expect(left).toHaveLength(1) // the marker
    // A new device with the new code gets everything; B signs in again with it.
    const c = device(network, 'c')
    await signInToAccount(c, fresh)
    await signInToAccount(b, fresh)
    await converge(a, b, c)
    expect(await titles(c)).toEqual(['Kept'])
    expect((await accountSummary(b.db)).phase).toBe('on')
  })

  it('signing out keeps or removes this device copy and never deletes anything elsewhere', async () => {
    const network = new MemoryNetwork()
    const { d: a, secret } = await accountDevice(network, 'a')
    await createItem(a.db, { title: 'Stays' }, a.now())
    await sync(a)
    const b = device(network, 'b')
    await signInToAccount(b, secret)
    const c = device(network, 'c')
    await signInToAccount(c, secret)
    await converge(a, b, c)

    await signOutOfAccount(b.db, { removeData: false })
    expect(await titles(b)).toEqual(['Stays'])
    expect((await sync(b)).state).toBe('off')
    await signOutOfAccount(c.db, { removeData: true })
    expect(await titles(c)).toEqual([])
    expect((await getSettings(c.db)).onboarding).toBeUndefined()
    await converge(a)
    expect(await titles(a)).toEqual(['Stays'])
  })

  it('sync can be turned off on one device', async () => {
    const network = new MemoryNetwork()
    const { d: a, secret } = await accountDevice(network, 'a')
    await sync(a)
    const b = device(network, 'b')
    await signInToAccount(b, secret)
    await converge(a, b)
    await setAccountSync(b.db, false)
    a.clock.advance(1000)
    await createItem(a.db, { title: 'Not here' }, a.now())
    await sync(a)
    expect((await sync(b)).state).toBe('off')
    expect(await titles(b)).toEqual([])
    const pub = deriveAccountKeys(secret).pubkey
    expect(countAccountEvents(network, pub)).toBeGreaterThan(0)
    expect(accountFilter(deriveAccountKeys(secret))).toMatchObject({ authors: [pub] })
  })
})

describe('database upgrade', () => {
  it('version 3 adds the account table and leaves every existing row as it was', async () => {
    const name = `hippo-migrate-${randomId()}`
    const old = new Dexie(name)
    old.version(1).stores({ items: 'id, updatedAt, archivedAt, *categoryIds', categories: 'id, order', sharedLists: 'id, status', guestLists: 'topic, lastOpenedAt', events: '[topic+d], topic', settings: 'key' })
    old.version(2).stores({ retiredLists: 'topic, ownerPubkey, listId' })
    await old.open()
    const item = { id: randomId(), title: 'Kept', quantity: 1, importance: 'want', categoryIds: [], allowContributions: false, createdAt: 1, updatedAt: 1 }
    await old.table('items').put(item)
    await old.table('settings').put({ key: 'ownerName', value: 'Ann' })
    await old.table('events').put({ topic: 't', d: 'd', event: { id: 'x' } })
    // Every table 0.1.5 wrote (its schema is versions 1 and 2 above).
    await old.table('categories').put({ id: 'c1', name: 'Kitchen', order: 0 })
    await old.table('sharedLists').put({ id: 'l1', status: 'published' })
    await old.table('guestLists').put({ topic: 'g1', lastOpenedAt: 5 })
    await old.table('retiredLists').put({ topic: 'r1', ownerPubkey: 'p', listId: 'l0' })
    old.close()
    const db = openDb(name)
    expect(await db.items.get(item.id)).toEqual(item)
    expect(await db.categories.get('c1')).toEqual({ id: 'c1', name: 'Kitchen', order: 0 })
    expect(await db.sharedLists.count()).toBe(1)
    expect(await db.guestLists.count()).toBe(1)
    expect(await db.retiredLists.count()).toBe(1)
    // Nothing about an account until the person turns it on.
    expect(await db.settings.get('account')).toBeUndefined()
    expect((await db.settings.get('ownerName'))?.value).toBe('Ann')
    expect(await db.events.count()).toBe(1)
    expect(await db.accountRecords.count()).toBe(0)
    expect(db.verno).toBe(3)
    db.close()
  })
})
