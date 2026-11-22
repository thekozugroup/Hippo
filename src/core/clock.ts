// The device clock, corrected. Claims are ordered and judged by time
// (PROTOCOL.md sections 5 and 6), and other devices drop a claim dated more
// than ten minutes ahead of them. A device whose clock is wrong would then
// see its own claim counted while everyone else ignores it, or ignore other
// people's honest claims. So the app measures how far this device's clock is
// from a trusted source and uses the corrected time wherever it stamps or
// judges time (PROTOCOL.md section 10, note 13).
//
// The trusted source is the `Date` header of a request to the app's own
// origin (the host that serves Hippo; on GitHub Pages, GitHub's servers). It
// is never a third party and never relay data, which anyone with a link can
// influence. Without an answer (offline on a first run) the device clock is
// used unchanged.

/** Milliseconds since epoch, as a dependency services can be given. */
export type NowFn = () => number

/** A clock that services read time from. */
export interface Clock {
  /** Corrected milliseconds since epoch. */
  now(): number
  /** How far the device clock is behind the trusted time, in ms (positive: the device is slow); undefined before a measurement. */
  offset(): number | undefined
  /** Resolves once the first measurement has finished or failed (at most a few seconds). */
  ready(): Promise<void>
  /** Called when the offset changes; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void
}

/** The device clock as it is: used by tests and when no correction is wanted. */
export function systemNow(): number {
  return Date.now()
}

export const systemClock: Clock = {
  now: systemNow,
  offset: () => undefined,
  ready: () => Promise.resolve(),
  subscribe: () => () => undefined,
}

/** A clock that is wrong by a fixed amount; for tests of skewed devices. */
export function fixedOffsetClock(skewMs: number, base: NowFn = systemNow): Clock {
  return { now: () => base() + skewMs, offset: () => undefined, ready: () => Promise.resolve(), subscribe: () => () => undefined }
}

/** An offset beyond this is worth telling the person about (finding: about two minutes). */
export const CLOCK_WARN_MS = 2 * 60 * 1000

/** A measurement is not trusted when the round trip took longer than this. */
const MAX_ROUND_TRIP_MS = 10_000
/** The wall clock and the monotonic clock may drift apart by this much before the offset is measured again. */
const JUMP_TOLERANCE_MS = 2_000
const DEFAULT_REFRESH_MS = 30 * 60 * 1000
const DEFAULT_READY_TIMEOUT_MS = 3_000
/** A stored offset is used for this long, until a new measurement replaces it. */
const STORED_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const CLOCK_STORAGE_KEY = 'hippo:clock'

export interface DateSample {
  /** The response's `Date` header. */
  date: string | null
  /** The response's `Age` header (seconds a shared cache held it), if any. */
  age?: string | null
  /** Device wall clock and monotonic clock when the request started, and the monotonic clock when the answer arrived. */
  wallStart: number
  monoStart: number
  monoEnd: number
}

/**
 * Offset (trusted minus device) from one request, or undefined when the
 * sample cannot be trusted. The `Date` header has whole seconds and is
 * truncated, so its midpoint (+500 ms) is compared with the device time
 * halfway through the round trip. The error is at most half the round trip
 * plus half a second.
 */
export function offsetFromSample(s: DateSample): number | undefined {
  if (!s.date) return undefined
  const server = Date.parse(s.date)
  if (!Number.isFinite(server)) return undefined
  const rtt = s.monoEnd - s.monoStart
  if (!(rtt >= 0) || rtt > MAX_ROUND_TRIP_MS) return undefined
  const ageSeconds = s.age && /^\d{1,9}$/.test(s.age) ? Number(s.age) : 0
  const trusted = server + 500 + ageSeconds * 1000
  const device = s.wallStart + rtt / 2
  return Math.round(trusted - device)
}

export interface TimeSyncOptions {
  /** A same-origin address to ask with HEAD; a fresh query string is added so no cache answers. */
  url: string | URL
  fetch?: (input: string, init: RequestInit) => Promise<Pick<Response, 'headers'>>
  /** Device wall clock (Date.now) and monotonic clock (performance.now). */
  wallNow?: NowFn
  monoNow?: NowFn
  /** Where to keep the last estimate between visits (localStorage); null for none. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
  /** How often to measure again while the app runs. */
  refreshMs?: number
  /** `ready()` resolves after this long even without an answer. */
  readyTimeoutMs?: number
  /** Timers; tests pass fakes. */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (id: unknown) => void
}

interface Anchor {
  offset: number
  wall: number
  mono: number
}

/**
 * Measures and keeps this device's clock offset. `now()` is the device clock
 * plus the last measured offset. The monotonic clock tells when the device
 * clock was changed (or the device slept): the wall and monotonic clocks then
 * drift apart, and the offset is measured again.
 */
export class TimeSync implements Clock {
  private anchor: Anchor | undefined
  private readonly url: URL
  private readonly doFetch: NonNullable<TimeSyncOptions['fetch']>
  private readonly wallNow: NowFn
  private readonly monoNow: NowFn
  private readonly storage: TimeSyncOptions['storage']
  private readonly refreshMs: number
  private readonly readyTimeoutMs: number
  private readonly setTimer: NonNullable<TimeSyncOptions['setTimer']>
  private readonly clearTimer: NonNullable<TimeSyncOptions['clearTimer']>
  private readonly listeners = new Set<() => void>()
  private inflight: Promise<boolean> | null = null
  private readyPromise: Promise<void> | null = null
  private lastMeasuredMono: number | undefined
  private refreshTimer: unknown = undefined
  private stopped = false

  constructor(options: TimeSyncOptions) {
    this.url = new URL(options.url)
    this.doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.wallNow = options.wallNow ?? systemNow
    this.monoNow = options.monoNow ?? (() => globalThis.performance.now())
    this.storage = options.storage ?? null
    this.refreshMs = options.refreshMs ?? DEFAULT_REFRESH_MS
    this.readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = options.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>))
    this.loadStored()
  }

  now(): number {
    const a = this.anchor
    const wall = this.wallNow()
    if (!a) return wall
    const mono = this.monoNow()
    if (Math.abs(wall - a.wall - (mono - a.mono)) > JUMP_TOLERANCE_MS) {
      // The device clock moved (or the device slept). Keep the offset until a new measurement says otherwise.
      void this.refresh()
    }
    return wall + a.offset
  }

  offset(): number | undefined {
    return this.anchor?.offset
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Starts the first measurement (once) and resolves when it is done, or after `readyTimeoutMs`. */
  ready(): Promise<void> {
    this.readyPromise ??= new Promise<void>((resolve) => {
      const id = this.setTimer(resolve, this.readyTimeoutMs)
      void this.refresh().finally(() => {
        this.clearTimer(id)
        resolve()
      })
    })
    return this.readyPromise
  }

  /** Measures now unless a measurement is running. Resolves true when the offset was measured. Never throws. */
  refresh(): Promise<boolean> {
    if (this.stopped) return Promise.resolve(false)
    this.inflight ??= this.measure().finally(() => {
      this.inflight = null
      this.scheduleRefresh()
    })
    return this.inflight
  }

  /** Measures again if the last measurement is older than `minAgeMs` (for example when the page becomes visible). */
  refreshIfOlderThan(minAgeMs: number): Promise<boolean> {
    if (this.lastMeasuredMono !== undefined && this.monoNow() - this.lastMeasuredMono < minAgeMs) return Promise.resolve(false)
    return this.refresh()
  }

  stop(): void {
    this.stopped = true
    if (this.refreshTimer !== undefined) this.clearTimer(this.refreshTimer)
    this.refreshTimer = undefined
  }

  private scheduleRefresh(): void {
    if (this.stopped) return
    if (this.refreshTimer !== undefined) this.clearTimer(this.refreshTimer)
    this.refreshTimer = this.setTimer(() => {
      this.refreshTimer = undefined
      void this.refresh()
    }, this.refreshMs)
  }

  private async measure(): Promise<boolean> {
    const url = new URL(this.url)
    url.searchParams.set('hippo-time', Math.random().toString(36).slice(2))
    const wallStart = this.wallNow()
    const monoStart = this.monoNow()
    let headers: Headers
    try {
      const res = await this.doFetch(url.href, { method: 'HEAD', cache: 'no-store', credentials: 'omit', redirect: 'error' })
      headers = res.headers
    } catch {
      return false
    }
    const monoEnd = this.monoNow()
    const offset = offsetFromSample({ date: headers.get('date'), age: headers.get('age'), wallStart, monoStart, monoEnd })
    if (offset === undefined) return false
    this.lastMeasuredMono = monoEnd
    this.set({ offset, wall: wallStart + (monoEnd - monoStart), mono: monoEnd })
    return true
  }

  private set(anchor: Anchor): void {
    const before = this.anchor?.offset
    this.anchor = anchor
    try {
      this.storage?.setItem(CLOCK_STORAGE_KEY, JSON.stringify({ offset: anchor.offset, at: anchor.wall + anchor.offset }))
    } catch {
      // Storage unavailable: the estimate lasts for this page only.
    }
    if (before !== anchor.offset) for (const l of [...this.listeners]) l()
  }

  private loadStored(): void {
    let raw: string | null = null
    try {
      raw = this.storage?.getItem(CLOCK_STORAGE_KEY) ?? null
    } catch {
      return
    }
    if (!raw) return
    try {
      const v: unknown = JSON.parse(raw)
      if (typeof v !== 'object' || v === null) return
      const { offset, at } = v as Record<string, unknown>
      if (typeof offset !== 'number' || !Number.isFinite(offset) || typeof at !== 'number' || !Number.isFinite(at)) return
      const wall = this.wallNow()
      // Only a recent estimate counts, judged by the corrected time it implies.
      const age = wall + offset - at
      if (age < 0 || age > STORED_MAX_AGE_MS) return
      this.anchor = { offset, wall, mono: this.monoNow() }
    } catch {
      // A broken value is ignored; the next measurement replaces it.
    }
  }
}

/** "1 hour", "3 minutes", "2 days": how far off a clock is, for a sentence. */
export function describeClockOffset(ms: number): string {
  const abs = Math.abs(ms)
  const unit = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`
  if (abs >= 22 * 3600_000) return unit(Math.max(1, Math.round(abs / 86_400_000)), 'day')
  if (abs >= 55 * 60_000) return unit(Math.max(1, Math.round(abs / 3600_000)), 'hour')
  return unit(Math.max(1, Math.round(abs / 60_000)), 'minute')
}
