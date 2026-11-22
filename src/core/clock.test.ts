// @vitest-environment node
// The corrected clock (TimeSync) and what it is for: devices with wrong clocks
// agree with everyone else on who is getting what (PROTOCOL.md section 10, note 13).
import { afterEach, describe, expect, it } from 'vitest'
import { CLOCK_STORAGE_KEY, TimeSync, describeClockOffset, fixedOffsetClock, offsetFromSample, type Clock } from './clock.ts'
import { LIMITS } from './model/limits.ts'
import { addGuestListFromLink, openGuestList, type GiverListSession } from './services/giver-lists.ts'
import { buildShareLink, createSharedList, publishList, sharedItemIdFor } from './services/owner-lists.ts'
import { createItem } from './services/wishlist.ts'
import { testClock, testDevice, waitFor, type TestClock } from './testing/fixtures.ts'
import { MemoryNetwork } from './transport/memory.ts'

const HOUR = 3600_000
const DAY = 24 * HOUR

function headers(values: Record<string, string>): Pick<Response, 'headers'> {
  return { headers: new Headers(values) }
}

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) }
}

/** A TimeSync for a device whose clock is `skewMs` off the true time, measuring against a server on the true time. */
function syncFor(truth: TestClock, skewMs: number, opts: { offline?: boolean; storage?: ReturnType<typeof memoryStorage> } = {}) {
  const requests: string[] = []
  const sync = new TimeSync({
    url: 'https://hippo.example/app/',
    wallNow: () => truth.now() + skewMs,
    monoNow: () => truth.now(),
    storage: opts.storage ?? null,
    fetch: (url, init) => {
      requests.push(`${init.method ?? 'GET'} ${url}`)
      if (opts.offline) return Promise.reject(new TypeError('Failed to fetch'))
      return Promise.resolve(headers({ date: new Date(truth.now()).toUTCString() }))
    },
    setTimer: () => 0,
    clearTimer: () => undefined,
  })
  return { sync, requests }
}

describe('offsetFromSample', () => {
  it('compares the Date header (plus half a second for truncation) with the device time halfway through the request', () => {
    const wallStart = Date.UTC(2026, 10, 1, 12, 0, 0) + HOUR // device one hour fast
    const offset = offsetFromSample({ date: new Date(Date.UTC(2026, 10, 1, 12, 0, 0)).toUTCString(), wallStart, monoStart: 100, monoEnd: 300 })
    expect(offset).toBe(-HOUR + 500 - 100)
  })

  it('adds the Age a shared cache reports', () => {
    const t = Date.UTC(2026, 10, 1)
    expect(offsetFromSample({ date: new Date(t).toUTCString(), age: '30', wallStart: t, monoStart: 0, monoEnd: 0 })).toBe(30_500)
  })

  it('refuses a missing or unreadable header and a slow round trip', () => {
    const base = { wallStart: 0, monoStart: 0, monoEnd: 10 }
    expect(offsetFromSample({ ...base, date: null })).toBeUndefined()
    expect(offsetFromSample({ ...base, date: 'yesterday-ish' })).toBeUndefined()
    expect(offsetFromSample({ date: new Date(0).toUTCString(), wallStart: 0, monoStart: 0, monoEnd: 20_000 })).toBeUndefined()
  })
})

describe('TimeSync', () => {
  it('asks its own address with a fresh HEAD request and corrects now()', async () => {
    const truth = testClock()
    const { sync, requests } = syncFor(truth, HOUR)
    expect(sync.now()).toBe(truth.now() + HOUR) // before measuring: the device clock as it is
    await sync.ready()
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatch(/^HEAD https:\/\/hippo\.example\/app\/\?hippo-time=[a-z0-9]+$/)
    expect(Math.abs(sync.now() - truth.now())).toBeLessThanOrEqual(1000)
    expect(Math.abs((sync.offset() ?? 0) + HOUR)).toBeLessThanOrEqual(1000)
  })

  it('behaves like the device clock when no answer comes (offline first run)', async () => {
    const truth = testClock()
    const { sync } = syncFor(truth, -DAY, { offline: true })
    await sync.ready()
    expect(sync.offset()).toBeUndefined()
    expect(sync.now()).toBe(truth.now() - DAY)
  })

  it('keeps the estimate between visits and measures again when the device clock jumps', async () => {
    const truth = testClock()
    const storage = memoryStorage()
    const first = syncFor(truth, HOUR, { storage })
    await first.sync.ready()
    expect(storage.map.get(CLOCK_STORAGE_KEY)).toBeDefined()

    // A new visit starts corrected from the stored estimate, before any request.
    const second = syncFor(truth, HOUR, { storage, offline: true })
    expect(Math.abs(second.sync.now() - truth.now())).toBeLessThanOrEqual(1000)
    expect(second.requests).toHaveLength(0)

    // The device clock is set right while the app runs: the wall and monotonic clocks drift apart, so it measures again.
    let skew = HOUR
    const jumped = new TimeSync({
      url: 'https://hippo.example/',
      wallNow: () => truth.now() + skew,
      monoNow: () => truth.now(),
      fetch: () => Promise.resolve(headers({ date: new Date(truth.now()).toUTCString() })),
      setTimer: () => 0,
      clearTimer: () => undefined,
    })
    await jumped.ready()
    let changes = 0
    jumped.subscribe(() => changes++)
    skew = 0
    jumped.now()
    await waitFor(() => changes > 0)
    expect(Math.abs(jumped.offset() ?? HOUR)).toBeLessThanOrEqual(1000)
  })

  it('ignores an old stored estimate', () => {
    const truth = testClock()
    const storage = memoryStorage()
    storage.setItem(CLOCK_STORAGE_KEY, JSON.stringify({ offset: HOUR, at: truth.now() - 2 * DAY }))
    const { sync } = syncFor(truth, 0, { storage, offline: true })
    expect(sync.offset()).toBeUndefined()
  })

  it('describes an offset in words', () => {
    expect(describeClockOffset(HOUR)).toBe('1 hour')
    expect(describeClockOffset(-3 * 60_000)).toBe('3 minutes')
    expect(describeClockOffset(DAY)).toBe('1 day')
    expect(describeClockOffset(-2 * DAY)).toBe('2 days')
  })
})

// ---- Agreement between devices whose clocks are wrong ----

const sessions: GiverListSession[] = []
afterEach(() => {
  for (const s of sessions.splice(0)) s.stop()
})

async function ownerWithList(network: MemoryNetwork, truth: TestClock) {
  const owner = testDevice(network, truth, 'owner')
  const scarf = await createItem(owner.db, { title: 'Scarf' }, truth.now())
  const lamp = await createItem(owner.db, { title: 'Lamp' }, truth.now())
  const list = await createSharedList(owner, { name: 'Birthday', itemIds: [scarf.id, lamp.id] })
  expect((await publishList(owner, list.id)).ok).toBe(true)
  return { scarf: sharedItemIdFor(list, scarf.id), lamp: sharedItemIdFor(list, lamp.id), link: buildShareLink(list, 'https://hippo.example/app/') }
}

/** A giver device with its own (possibly wrong) clock; `clock` is how it reads time. */
async function giver(network: MemoryNetwork, link: string, name: string, truth: TestClock, clock: Clock) {
  const device = testDevice(network, truth, name)
  const deps = { ...device, now: () => clock.now(), clockSync: clock }
  const guest = await addGuestListFromLink(deps, link)
  const session = await openGuestList(deps, guest.topic, { eoseTimeoutMs: 200, retryMs: 100 })
  sessions.push(session)
  await session.start()
  await waitFor(() => session.getSnapshot().status === 'live')
  return session
}

/** Who each device says is getting an item: the claim id counted for it, or null. */
function counted(session: GiverListSession, itemId: string): string | null {
  const v = session.getSnapshot().items.find((i) => i.item.id === itemId)
  return v?.state.rows.find((r) => r.kind === 'full' && !r.conflict)?.claimId ?? null
}

describe.each([
  ['one hour fast', HOUR],
  ['one hour slow', -HOUR],
  ['one day fast', DAY],
  ['one day slow', -DAY],
])('a giver whose clock is %s', (_label, skew) => {
  it('is corrected, and every device agrees on who is getting what', async () => {
    const truth = testClock()
    const network = new MemoryNetwork({ nowSeconds: () => Math.floor(truth.now() / 1000) })
    const { scarf, lamp, link } = await ownerWithList(network, truth)

    const skewed = syncFor(truth, skew).sync
    await skewed.ready()
    const wrong = await giver(network, link, 'wrong', truth, skewed)
    const honest = await giver(network, link, 'honest', truth, fixedOffsetClock(0, truth.now))
    const observer = await giver(network, link, 'observer', truth, fixedOffsetClock(0, truth.now))

    // The giver with the wrong clock gets the scarf: it is counted for everyone, and their own check says so.
    const mine = await wrong.claim(scarf)
    expect(mine.outcome).toEqual({ kind: 'counted' })
    await waitFor(() => counted(honest, scarf) === mine.claim.id && counted(observer, scarf) === mine.claim.id)
    expect(counted(wrong, scarf)).toBe(mine.claim.id)
    expect(mine.claim.createdAt).toBeLessThanOrEqual(truth.now() + 1000)

    // An honest giver gets the lamp a minute later; the wrong-clock giver sees it, so cannot take it too.
    truth.advance(60_000)
    const theirs = await honest.claim(lamp)
    await waitFor(() => counted(wrong, lamp) === theirs.claim.id && counted(observer, lamp) === theirs.claim.id)
    await expect(wrong.claim(lamp)).rejects.toThrow()

    // Everyone holds the same picture.
    for (const s of [wrong, honest, observer]) {
      expect(counted(s, scarf)).toBe(mine.claim.id)
      expect(counted(s, lamp)).toBe(theirs.claim.id)
    }
  })
})

describe('without a correction (what the correction prevents)', () => {
  it('a claim from a clock one hour fast is dropped by every other device', async () => {
    const truth = testClock()
    const network = new MemoryNetwork({ nowSeconds: () => Math.floor(truth.now() / 1000) })
    const { scarf, link } = await ownerWithList(network, truth)
    const fast = await giver(network, link, 'fast', truth, fixedOffsetClock(HOUR, truth.now))
    const honest = await giver(network, link, 'honest', truth, fixedOffsetClock(0, truth.now))
    const r = await fast.claim(scarf)
    expect(r.result.ok).toBe(true)
    expect(counted(fast, scarf)).toBe(r.claim.id)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(counted(honest, scarf)).toBeNull()
    expect(LIMITS.futureSkewMs).toBeLessThan(HOUR)
  })
})

describe('the outcome a giver is told', () => {
  it('is "not counted" when another claim that was counted first arrives while mine is being sent', async () => {
    const truth = testClock()
    const network = new MemoryNetwork({ nowSeconds: () => Math.floor(truth.now() / 1000) })
    const { scarf, link } = await ownerWithList(network, truth)
    const ann = await giver(network, link, 'ann', truth, fixedOffsetClock(0, truth.now))

    // Ben is on his own relay, which has the list but not yet Ann's claim.
    const benNet = new MemoryNetwork({ nowSeconds: () => Math.floor(truth.now() / 1000) })
    for (const e of network.store.query({})) benNet.store.add(e)
    const annClaim = await ann.claim(scarf)
    const annEvents = network.store.query({}).filter((e) => e.tags.some((t) => t[0] === 'd' && t[1]?.endsWith(`:claim:${annClaim.claim.id}`)))
    expect(annEvents).toHaveLength(1)

    const benDevice = testDevice(benNet, truth, 'ben')
    const inner = benDevice.transport
    const wrapped = {
      publish: async (e: Parameters<typeof inner.publish>[0]) => {
        // Ann's earlier claim reaches Ben's relay (and Ben) while his own is on its way.
        for (const a of annEvents) {
          benNet.store.add(a)
          benNet.broadcast(a)
        }
        await new Promise((resolve) => setTimeout(resolve, 0))
        return inner.publish(e)
      },
      subscribe: inner.subscribe.bind(inner),
      fetch: inner.fetch.bind(inner),
      close: inner.close.bind(inner),
    }
    const benDeps = { ...benDevice, transports: () => wrapped }
    const guest = await addGuestListFromLink(benDeps, link)
    const ben = await openGuestList(benDeps, guest.topic, { eoseTimeoutMs: 200, retryMs: 100 })
    sessions.push(ben)
    await ben.start()
    await waitFor(() => ben.getSnapshot().status === 'live')
    truth.advance(1000)
    const benClaim = await ben.claim(scarf)
    expect(benClaim.result.ok).toBe(true)
    expect(benClaim.outcome).toEqual({ kind: 'not-counted', reason: 'taken' })
    await waitFor(() => counted(ben, scarf) === annClaim.claim.id)
  })

  it('is "rejected" for an event other devices would drop as dated in the future', async () => {
    const truth = testClock()
    const network = new MemoryNetwork({ nowSeconds: () => Math.floor(truth.now() / 1000) })
    const { scarf, link } = await ownerWithList(network, truth)
    // The device stamps with a clock an hour fast but judges with the true time (its correction arrived late).
    const device = testDevice(network, truth, 'late')
    let stampSkew = HOUR
    const deps = { ...device, now: () => truth.now() + stampSkew }
    const guest = await addGuestListFromLink(deps, link)
    const session = await openGuestList(deps, guest.topic, { eoseTimeoutMs: 200, retryMs: 100 })
    sessions.push(session)
    await session.start()
    await waitFor(() => session.getSnapshot().status === 'live')
    const first = await session.claim(scarf)
    expect(first.outcome).toEqual({ kind: 'counted' })
    // The correction arrives: the claim it already sent is now judged as other devices judge it.
    stampSkew = 0
    const again = await session.markPurchased(first.claim.id)
    expect(again.outcome).toEqual({ kind: 'rejected', reason: 'future' })
  })
})
