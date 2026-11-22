// Background retry of owner-side sync (shared lists whose latest state no
// relay has accepted yet). Runs one pass at start, when the browser comes
// back online, when the page becomes visible, and on a backoff timer while
// anything is still pending. Passes never overlap, and events closer
// together than `minGapMs` are folded into one pass, so relays are not
// hammered.

export interface RetryPass {
  /** True while something is still waiting for a relay. */
  pending: boolean
}

interface Listenable {
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

export interface SyncRetryOptions {
  /** First timer delay after a pass that left something pending. */
  baseMs?: number
  /** Longest timer delay. */
  maxMs?: number
  /** Ignore event triggers this soon after the previous pass started. */
  minGapMs?: number
  /** Event source for `online` (window). */
  target?: Listenable
  /** Event source for `visibilitychange` (document). */
  doc?: Listenable & { readonly visibilityState: DocumentVisibilityState }
  now?: () => number
}

export interface SyncRetry {
  /** Schedule a pass after the base delay (unless one is due already), e.g. after a local change failed to send. */
  nudge(): void
  stop(): void
}

export function startSyncRetry(run: () => Promise<RetryPass>, options: SyncRetryOptions = {}): SyncRetry {
  const baseMs = options.baseMs ?? 8_000
  const maxMs = options.maxMs ?? 5 * 60_000
  const minGapMs = options.minGapMs ?? 3_000
  const target = options.target ?? window
  const doc = options.doc ?? document
  const now = options.now ?? (() => Date.now())

  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let again = false
  let stopped = false
  let lastStart = -Infinity

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  const schedule = () => {
    if (stopped || timer !== null) return
    const delay = Math.min(maxMs, baseMs * 2 ** attempt)
    attempt++
    timer = setTimeout(() => {
      timer = null
      void pass()
    }, delay)
  }

  const pass = async (): Promise<void> => {
    if (stopped) return
    if (running) {
      again = true
      return
    }
    running = true
    lastStart = now()
    clearTimer()
    let pending = true
    try {
      pending = (await run()).pending
    } catch {
      pending = true
    }
    running = false
    if (stopped) return
    if (again) {
      again = false
      void pass()
      return
    }
    if (pending) schedule()
    else attempt = 0
  }

  const onEvent = () => {
    if (now() - lastStart < minGapMs) return
    attempt = 0 // conditions changed: start the backoff over
    void pass()
  }
  const onOnline = () => onEvent()
  const onVisible = () => {
    if (doc.visibilityState === 'visible') onEvent()
  }

  target.addEventListener('online', onOnline)
  doc.addEventListener('visibilitychange', onVisible)
  void pass()

  return {
    nudge: () => {
      // A change just failed to send: try again after the base delay (not at once, which would fail the same way).
      if (running || timer !== null) return
      attempt = 0
      schedule()
    },
    stop: () => {
      stopped = true
      clearTimer()
      target.removeEventListener('online', onOnline)
      doc.removeEventListener('visibilitychange', onVisible)
    },
  }
}
