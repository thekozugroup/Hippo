import { startSyncRetry } from './sync-retry.ts'

function fakeEnv() {
  const target = new EventTarget()
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState })
  return { target, doc }
}

describe('background sync retry', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('runs at start, then backs off while something is pending, and stops when all is sent', async () => {
    const { target, doc } = fakeEnv()
    const results = [true, true, true, false]
    const run = vi.fn(async () => ({ pending: results.shift() ?? false }))
    const r = startSyncRetry(run, { baseMs: 1000, maxMs: 10_000, target, doc })
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(999)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2000) // doubled
    expect(run).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(4000)
    expect(run).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(run).toHaveBeenCalledTimes(4) // nothing pending: no more timers
    r.stop()
  })

  it('retries when the browser comes online or the page becomes visible, but not in bursts', async () => {
    const { target, doc } = fakeEnv()
    const run = vi.fn(async () => ({ pending: false }))
    const r = startSyncRetry(run, { minGapMs: 3000, target, doc })
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(1)
    target.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(1) // too soon after the start pass
    await vi.advanceTimersByTimeAsync(3000)
    target.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(3000)
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(2)
    doc.visibilityState = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(3)
    r.stop()
    target.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('never runs two passes at once, and a nudge waits for the base delay', async () => {
    const { target, doc } = fakeEnv()
    let release: () => void = () => undefined
    const run = vi.fn(
      () =>
        new Promise<{ pending: boolean }>((resolve) => {
          release = () => resolve({ pending: false })
        }),
    )
    const r = startSyncRetry(run, { baseMs: 500, minGapMs: 0, target, doc })
    await vi.advanceTimersByTimeAsync(0)
    target.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(2) // the folded trigger runs after the first pass
    release()
    await vi.advanceTimersByTimeAsync(0)
    r.nudge()
    await vi.advanceTimersByTimeAsync(499)
    expect(run).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(3)
    release()
    r.stop()
  })
})
